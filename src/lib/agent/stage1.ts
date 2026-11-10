import type Anthropic from "@anthropic-ai/sdk";
import { ShotPlanSchema, type PlanRequest, type ShotPlan } from "../schema";
import { ALL_TOOL_SPECS, SUBMIT_PLAN, TOOLS, type ToolContext } from "./tools";

/**
 * STAGE 1: a single agent with tools.
 *
 * One model, one loop:
 *   call Claude → it requests tools → run them → feed back the results → repeat
 *   until it calls `submit_plan` with a schema-valid plan.
 *
 * The loop only retries on *schema* errors (malformed output). Judging plan *quality*
 * (rule checks, critique, revision) is deliberately left to Stage 3, so the evals can
 * measure what that extra machinery actually buys.
 */

export const SYSTEM_PROMPT = `You are PerfectShot, a portrait photography planner for beginners.

Your job: produce a Shot Plan for an outdoor natural-light portrait shoot.

How to work:
1. Gather facts with the tools first: get_sun_data, get_weather, get_gear_specs, get_pose_library. Call independent tools in parallel.
2. Reason about the light: when it is soft and warm, where the sun is, and how to place the subject (backlight, side light, or open shade) given the location's likely layout. Avoid harsh midday sun unless open shade is available.
3. Choose settings the user's gear can actually do. Never go wider than the lens's widest aperture or above the body's usable ISO. For zoom lenses, state focalLengthMm.
4. Pick 3–5 poses, preferably from the library (set libraryId), suited to the subject count and light.
5. Call submit_plan exactly once.

Rules:
- Never invent a number a tool can give you (times, sun angles, forecast values, gear limits). Copy times and azimuths from tool results.
- If there's no forecast, say so and give a seasonal caveat; don't fabricate one.
- Write for beginners: plain language, explain any jargon in a few words, and give cues the photographer can read aloud.
- Safety first: never place people near cliff edges, on roads, or anywhere else dangerous.`;

export type TraceStep =
  | { type: "model"; turn: number; stopReason: string | null; ms: number; inputTokens: number; outputTokens: number }
  | { type: "tool"; turn: number; name: string; input: unknown; ms: number; error?: string }
  /** Stage 2+: one node of the graph (a single structured model call, or a code step) */
  | { type: "node"; name: string; kind: "code" | "model"; ms: number; attempts?: number; inputTokens?: number; outputTokens?: number; startedAtMs: number; error?: string };

export type AgentResult = {
  plan: ShotPlan;
  trace: TraceStep[];
  usage: { inputTokens: number; outputTokens: number };
  turns: number;
  model: string;
};

export type CreateMessage = (
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Messages.Message>;

export type Stage1Options = ToolContext & {
  create: CreateMessage;
  model: string;
  maxTurns?: number;
  maxSchemaRetries?: number;
};

export function userMessage(req: PlanRequest): string {
  return [
    `Plan a portrait shoot.`,
    `Location: ${req.location.name ?? "(unnamed)"} at lat ${req.location.lat}, lng ${req.location.lng}`,
    `Date: ${req.date}`,
    req.timeWindow ? `Preferred time window (local): ${req.timeWindow.start}–${req.timeWindow.end}` : `Time window: flexible; recommend the best`,
    `Gear: bodyId=${req.gear.bodyId}, lensId=${req.gear.lensId}`,
    `Subjects: ${req.subjects === 4 ? "group of 4+" : req.subjects}`,
    req.vibe ? `Vibe: ${req.vibe}` : null,
    req.notes ? `Notes from the photographer: ${req.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runStage1(req: PlanRequest, opts: Stage1Options): Promise<AgentResult> {
  const maxTurns = opts.maxTurns ?? 8;
  const maxSchemaRetries = opts.maxSchemaRetries ?? 2;
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: userMessage(req) }];
  const trace: TraceStep[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let schemaRetries = 0;

  for (let turn = 1; turn <= maxTurns; turn++) {
    const t0 = Date.now();
    const res = await opts.create({
      model: opts.model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: ALL_TOOL_SPECS,
      messages,
    });
    usage.inputTokens += res.usage.input_tokens;
    usage.outputTokens += res.usage.output_tokens;
    trace.push({
      type: "model",
      turn,
      stopReason: res.stop_reason,
      ms: Date.now() - t0,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    });
    messages.push({ role: "assistant", content: res.content });

    const toolUses = res.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      // The model answered in prose instead of submitting: nudge it back on track
      messages.push({ role: "user", content: "Please finish by calling submit_plan with the complete plan." });
      continue;
    }

    // Run all requested tools in parallel; Claude often asks for several at once
    const results = await Promise.all(
      toolUses.map(async (tu): Promise<{ block: Anthropic.Messages.ToolResultBlockParam; plan?: ShotPlan }> => {
        const t1 = Date.now();
        if (tu.name === SUBMIT_PLAN) {
          const parsed = ShotPlanSchema.safeParse(tu.input);
          if (parsed.success) {
            trace.push({ type: "tool", turn, name: tu.name, input: "(plan)", ms: Date.now() - t1 });
            return { block: { type: "tool_result", tool_use_id: tu.id, content: "Plan received." }, plan: parsed.data };
          }
          const error = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
          trace.push({ type: "tool", turn, name: tu.name, input: "(plan)", ms: Date.now() - t1, error });
          return {
            block: { type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Plan failed validation. Fix and resubmit:\n${error}` },
          };
        }
        const tool = TOOLS[tu.name];
        try {
          if (!tool) throw new Error(`Unknown tool ${tu.name}`);
          const out = await tool.run(tu.input, opts);
          trace.push({ type: "tool", turn, name: tu.name, input: tu.input, ms: Date.now() - t1 });
          return { block: { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) } };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          trace.push({ type: "tool", turn, name: tu.name, input: tu.input, ms: Date.now() - t1, error });
          return { block: { type: "tool_result", tool_use_id: tu.id, is_error: true, content: error } };
        }
      }),
    );

    const plan = results.find((r) => r.plan)?.plan;
    if (plan) return { plan, trace, usage, turns: turn, model: opts.model };

    if (results.some((r) => r.block.is_error && toolUses.find((t) => t.id === r.block.tool_use_id)?.name === SUBMIT_PLAN)) {
      if (++schemaRetries > maxSchemaRetries) throw new AgentError("Plan failed schema validation too many times", trace);
    }
    messages.push({ role: "user", content: results.map((r) => r.block) });
  }
  throw new AgentError(`No plan after ${maxTurns} turns`, trace);
}

export class AgentError extends Error {
  constructor(message: string, public trace: TraceStep[]) {
    super(message);
    this.name = "AgentError";
  }
}

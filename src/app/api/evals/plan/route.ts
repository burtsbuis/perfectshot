import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { runStage1 } from "@/lib/agent/stage1";
import { explainFailure } from "@/lib/agentErrors";
import { readAnthropicKey } from "@/lib/anthropicKey";
import { runChecks } from "@/lib/checks";
import { checkEvalPassword } from "@/lib/evals/auth";
import { getScenario } from "@/lib/evals/scenarios";
import { buildFacts } from "@/lib/facts";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Eval step 1: run the current agent on one scenario, apply the rule checks, and store the result.
 * One scenario per request keeps each call well under the hosting time limit.
 */
export const maxDuration = 300;

const AGENT_STAGE = 1;
const Body = z.object({ runId: z.string().min(1).max(64), scenarioId: z.number().int() });

export async function POST(request: Request) {
  const denied = checkEvalPassword(request);
  if (denied) return denied;

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const scenario = getScenario(body.data.scenarioId);
  if (!scenario) return Response.json({ error: `No scenario ${body.data.scenarioId}` }, { status: 404 });

  const db = getAdminClient();
  if (!db) return Response.json({ error: "Supabase isn't configured" }, { status: 500 });
  const apiKey = readAnthropicKey();
  if ("problem" in apiKey) return Response.json({ error: "The app isn't set up correctly yet.", detail: apiKey.problem }, { status: 500 });

  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  const base = { run_id: body.data.runId, scenario_id: scenario.id, agent_stage: AGENT_STAGE, model, request: scenario.request };
  const client = new Anthropic({ apiKey: apiKey.key });
  const t0 = Date.now();

  try {
    const facts = await buildFacts(scenario.request);
    const result = await runStage1(scenario.request, { create: (p) => client.messages.create(p), model });
    const checks = runChecks(result.plan, scenario.request, facts);
    const latencyMs = Date.now() - t0;

    const { data, error } = await db
      .from("eval_runs")
      .insert({
        ...base,
        facts,
        plan: result.plan,
        checks,
        latency_ms: latencyMs,
        turns: result.turns,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Saving eval result failed: ${error.message}`);

    return Response.json({
      rowId: data.id,
      plan: result.plan,
      checks,
      timezone: facts.timezone,
      meta: { agentStage: AGENT_STAGE, model, latencyMs, turns: result.turns, usage: result.usage, trace: result.trace },
    });
  } catch (err) {
    const { error, detail } = explainFailure(err, apiKey);
    await db.from("eval_runs").insert({ ...base, error: detail, latency_ms: Date.now() - t0 });
    return Response.json({ error, detail }, { status: 502 });
  }
}

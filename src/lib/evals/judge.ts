import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { CreateMessage } from "../agent/stage1";
import type { CheckResult } from "../checks";
import type { PlanRequest, ShootFacts, ShotPlan } from "../schema";
import { compassLabel } from "../sun";

/**
 * LLM-as-judge: scores a Shot Plan on the 4-part rubric from docs/spec.md.
 *
 * The judge sees the same facts the agent had (sun windows, sun direction, forecast, gear),
 * so it can tell a specific, grounded plan from a generic one. It doesn't re-check numbers;
 * the deterministic checks already do that, and they're shown to the judge.
 */

export const RUBRIC = {
  usefulness: "Could a beginner act on this plan on location without looking anything up?",
  lightReasoning: "Do the strategy and placements make physical sense given the sun's direction, time, and weather?",
  clarity: "Is it free of jargon, or is the jargon explained in a few words? Is it concise rather than a wall of text?",
  specificity: "Does it use this location, date, conditions, and gear, or could it be pasted onto any shoot?",
} as const;
export type RubricKey = keyof typeof RUBRIC;
export const RUBRIC_KEYS = Object.keys(RUBRIC) as RubricKey[];

const Score = z.object({ score: z.number().int().min(1).max(5), reason: z.string() });
export const JudgeScoresSchema = z.object({
  usefulness: Score,
  lightReasoning: Score,
  clarity: Score,
  specificity: Score,
  biggestWeakness: z.string(),
});
export type JudgeScores = z.infer<typeof JudgeScoresSchema>;

const SUBMIT = "submit_scores";

const JUDGE_SYSTEM = `You are a strict reviewer of portrait-shoot plans written for beginner photographers.
Score the plan 1–5 on each criterion. Anchors: 1 = wrong or useless, 3 = acceptable but generic or flawed, 5 = excellent, specific, and correct.
Be critical: a 5 should be rare. Base light judgments on the facts provided, not on assumptions.
Give a one-sentence reason per score, then name the plan's single biggest weakness. Submit with ${SUBMIT}.`;

const scoresTool: Anthropic.Messages.Tool = {
  name: SUBMIT,
  description: "Submit rubric scores for the plan.",
  input_schema: (() => {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(JudgeScoresSchema) as Record<string, unknown>;
    void _ignored;
    return schema as Anthropic.Messages.Tool.InputSchema;
  })(),
};

/** Compact facts for the judge: windows in local time and the sun's direction at each window's midpoint. */
export function factsBrief(facts: ShootFacts) {
  const tz = facts.timezone;
  const t = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }) : null;
  const sunAt = (iso: string) => {
    const target = Date.parse(iso);
    const p = facts.sun.positions.reduce((a, b) => (Math.abs(Date.parse(b.time) - target) < Math.abs(Date.parse(a.time) - target) ? b : a));
    return `${Math.round(p.azimuthDeg)}° ${compassLabel(p.azimuthDeg)}, ${p.altitudeDeg}° up`;
  };
  const win = (w: { start: string; end: string } | null) =>
    w ? `${t(w.start)}–${t(w.end)} (sun ${sunAt(new Date((Date.parse(w.start) + Date.parse(w.end)) / 2).toISOString())})` : "none";
  const hours = facts.weather?.hourly ?? [];
  return {
    timezone: tz,
    sunrise: t(facts.sun.sunrise),
    sunset: t(facts.sun.sunset),
    goldenHourMorning: win(facts.sun.goldenHourMorning),
    goldenHourEvening: win(facts.sun.goldenHourEvening),
    forecast: hours.length
      ? hours.filter((_, i) => i % 3 === 0).map((h) => `${t(h.time)}: ${h.cloudCoverPct}% cloud, ${h.precipProbPct}% rain`)
      : "No forecast (date too far ahead)",
    gear: `${facts.gear.body.name} + ${facts.gear.lens.name}`,
  };
}

export async function judgePlan(
  input: { request: PlanRequest; facts: ShootFacts; plan: ShotPlan; checks: CheckResult[]; focus?: string },
  opts: { create: CreateMessage; model: string },
): Promise<{ scores: JudgeScores; usage: { inputTokens: number; outputTokens: number } }> {
  const content = [
    `## What this scenario tests\n${input.focus ?? "General quality"}`,
    `## Request\n${JSON.stringify(input.request)}`,
    `## Facts the planner had\n${JSON.stringify(factsBrief(input.facts), null, 1)}`,
    `## Automated fact checks\n${input.checks.map((c) => `${c.status.toUpperCase()} ${c.id}: ${c.message}`).join("\n")}`,
    `## The plan\n${JSON.stringify(input.plan, null, 1)}`,
    `## Rubric\n${RUBRIC_KEYS.map((k) => `- ${k}: ${RUBRIC[k]}`).join("\n")}`,
  ].join("\n\n");

  // Not every model supports *forcing* a tool (tool_choice "tool"/"any"), so we ask for it
  // and, if the judge answers in prose instead, nudge it once more.
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content }];
  const usage = { inputTokens: 0, outputTokens: 0 };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await opts.create({ model: opts.model, max_tokens: 1500, system: JUDGE_SYSTEM, tools: [scoresTool], messages });
    usage.inputTokens += res.usage.input_tokens;
    usage.outputTokens += res.usage.output_tokens;
    const block = res.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use" && b.name === SUBMIT);
    if (block) return { scores: JudgeScoresSchema.parse(block.input), usage };
    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: `Please submit your scores now by calling ${SUBMIT}.` });
  }
  throw new Error("The judge didn't submit scores");
}

export const averageScore = (s: JudgeScores) => RUBRIC_KEYS.reduce((sum, k) => sum + s[k].score, 0) / RUBRIC_KEYS.length;

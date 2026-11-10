import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { explainFailure } from "@/lib/agentErrors";
import { readAnthropicKey } from "@/lib/anthropicKey";
import type { CheckResult } from "@/lib/checks";
import { checkEvalPassword } from "@/lib/evals/auth";
import { judgePlan } from "@/lib/evals/judge";
import { getScenario } from "@/lib/evals/scenarios";
import { ShootFactsSchema, ShotPlanSchema, PlanRequestSchema } from "@/lib/schema";
import { getAdminClient } from "@/lib/supabase/admin";

/** Eval step 2: score a stored plan with the LLM judge. Reads the plan from the database, not the browser. */
export const maxDuration = 120;

const Body = z.object({ rowId: z.string().uuid() });

export async function POST(request: Request) {
  const denied = checkEvalPassword(request);
  if (denied) return denied;

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const db = getAdminClient();
  if (!db) return Response.json({ error: "Supabase isn't configured" }, { status: 500 });
  const apiKey = readAnthropicKey();
  if ("problem" in apiKey) return Response.json({ error: "The app isn't set up correctly yet.", detail: apiKey.problem }, { status: 500 });

  const { data: row, error } = await db.from("eval_runs").select("*").eq("id", body.data.rowId).single();
  if (error || !row) return Response.json({ error: "Eval result not found" }, { status: 404 });
  if (!row.plan) return Response.json({ error: "This scenario has no plan to judge" }, { status: 400 });

  const judgeModel = process.env.EVAL_JUDGE_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  const client = new Anthropic({ apiKey: apiKey.key });
  try {
    const { scores, usage } = await judgePlan(
      {
        request: PlanRequestSchema.parse(row.request),
        facts: ShootFactsSchema.parse(row.facts),
        plan: ShotPlanSchema.parse(row.plan),
        checks: row.checks as CheckResult[],
        focus: getScenario(row.scenario_id)?.tests,
      },
      { create: (p) => client.messages.create(p), model: judgeModel },
    );
    await db
      .from("eval_runs")
      .update({ judge: scores, judge_model: judgeModel, judge_input_tokens: usage.inputTokens, judge_output_tokens: usage.outputTokens })
      .eq("id", row.id);
    return Response.json({ scores, judgeModel });
  } catch (err) {
    const { error, detail } = explainFailure(err, apiKey);
    return Response.json({ error: `Judging failed. ${error}`, detail }, { status: 502 });
  }
}

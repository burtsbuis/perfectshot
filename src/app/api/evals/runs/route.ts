import { checkEvalPassword } from "@/lib/evals/auth";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Past eval runs, so stored plans can be re-scored when the judge changes (ADR-020)
 * without paying to regenerate them.
 *   GET /api/evals/runs             → recent runs (id, stage, model, when, how many plans)
 *   GET /api/evals/runs?runId=...   → that run's latest result per scenario
 */
type Row = {
  id: string;
  run_id: string;
  scenario_id: number;
  created_at: string;
  agent_stage: number;
  model: string;
  plan: unknown;
  checks: unknown;
  judge: unknown;
  facts: { timezone?: string } | null;
  error: string | null;
  latency_ms: number | null;
  turns: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
};

export async function GET(request: Request) {
  const denied = checkEvalPassword(request);
  if (denied) return denied;
  const db = getAdminClient();
  if (!db) return Response.json({ error: "Supabase isn't configured" }, { status: 500 });

  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) {
    const { data, error } = await db
      .from("eval_runs")
      .select("run_id, agent_stage, model, created_at, scenario_id, plan")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const runs = new Map<string, { runId: string; stage: number; model: string; startedAt: string; plans: Set<number> }>();
    for (const r of data as Pick<Row, "run_id" | "agent_stage" | "model" | "created_at" | "scenario_id" | "plan">[]) {
      const run = runs.get(r.run_id) ?? { runId: r.run_id, stage: r.agent_stage, model: r.model, startedAt: r.created_at, plans: new Set<number>() };
      if (r.created_at < run.startedAt) run.startedAt = r.created_at;
      if (r.plan) run.plans.add(r.scenario_id);
      runs.set(r.run_id, run);
    }
    return Response.json({
      runs: [...runs.values()].slice(0, 20).map((r) => ({ runId: r.runId, stage: r.stage, model: r.model, startedAt: r.startedAt, plans: r.plans.size })),
    });
  }

  const { data, error } = await db.from("eval_runs").select("*").eq("run_id", runId).order("created_at", { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  // Latest attempt per scenario, preferring one that produced a plan (retries create extra rows)
  const best = new Map<number, Row>();
  for (const r of data as Row[]) {
    const prev = best.get(r.scenario_id);
    if (!prev || r.plan || !prev.plan) best.set(r.scenario_id, r);
  }
  return Response.json({
    runId,
    rows: [...best.values()].map((r) => ({
      scenarioId: r.scenario_id,
      rowId: r.id,
      stage: r.agent_stage,
      model: r.model,
      plan: r.plan,
      checks: r.checks,
      judge: r.judge,
      timezone: r.facts?.timezone ?? "UTC",
      error: r.error,
      latencyMs: r.latency_ms ?? 0,
      turns: r.turns ?? 0,
      usage: { inputTokens: r.input_tokens ?? 0, outputTokens: r.output_tokens ?? 0 },
    })),
  });
}

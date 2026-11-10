import type { CheckResult } from "./checks";
import type { ShotPlan } from "./schema";
import type { TraceStep } from "./agent/stage1";

/** Response shape of POST /api/plan (shared by the route and the UI). */
export type PlanResponse = {
  id: string | null;
  plan: ShotPlan;
  checks: CheckResult[];
  timezone: string;
  meta: {
    agentStage: number;
    model: string;
    latencyMs: number;
    turns: number;
    usage: { inputTokens: number; outputTokens: number };
    trace: TraceStep[];
  };
};

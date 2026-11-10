import type { PlanRequest, ShootFacts } from "../schema";
import { runStage1, type AgentResult, type CreateMessage } from "./stage1";
import { runStage2 } from "./stage2/graph";

/** Which agent architecture to run. Each stage stays runnable so the evals can compare them. */
export const STAGES = [1, 2] as const;
export type Stage = (typeof STAGES)[number];

export function defaultStage(): Stage {
  const n = Number(process.env.AGENT_STAGE ?? 2);
  return (STAGES as readonly number[]).includes(n) ? (n as Stage) : 2;
}

export function runAgent(stage: Stage, req: PlanRequest, opts: { create: CreateMessage; model: string; facts: ShootFacts }): Promise<AgentResult> {
  return stage === 1 ? runStage1(req, { create: opts.create, model: opts.model }) : runStage2(req, opts);
}

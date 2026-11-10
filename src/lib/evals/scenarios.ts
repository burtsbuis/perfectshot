import data from "../../../evals/scenarios.json";
import { PlanRequestSchema, type PlanRequest } from "../schema";

export type Scenario = { id: number; name: string; tests: string; timezone: string; request: PlanRequest };

export const SCENARIOS: Scenario[] = data.scenarios.map((s) => ({ ...s, request: PlanRequestSchema.parse(s.request) }));
export const getScenario = (id: number) => SCENARIOS.find((s) => s.id === id);

import { orientation } from "../../orientation";
import { getPose } from "../../poses";
import { ShotPlanSchema, type PlanRequest, type ShootFacts, type ShotPlan } from "../../schema";
import { buildCandidates, type CandidateWindow } from "../../windows";
import type { StructuredResult } from "../structured";
import { AgentError, type AgentResult, type TraceStep } from "../stage1";
import { lightNode, poseCandidates, posesNode, settingsNode, writerNode, type NodeCtx } from "./nodes";

/**
 * STAGE 2: an explicit graph instead of one open-ended loop.
 *
 *   facts (code) ─▶ windows + exposure (code) ─▶ LIGHT (model)
 *                                                  │
 *                                   ┌──────────────┴──────────────┐
 *                                   ▼                             ▼
 *                           SETTINGS (model)               POSES (model)      ← run in parallel
 *                                   └──────────────┬──────────────┘
 *                                                  ▼
 *                         orientation (code) ─▶ WRITER (model) ─▶ assemble (code) ─▶ ShotPlan
 *
 * What changed vs Stage 1, and which baseline failure each change targets:
 *  - Facts are computed up front and passed in, not fetched by tool calls → fewer turns, no misquoting.
 *  - The model picks windows and poses BY ID from code-built lists → no invented times or poses.
 *  - Light is decided once; settings, poses, and text all receive that decision → no contradictions.
 *  - Sun direction and "who stands where" come from code (orientation) → words match the diagram.
 *  - Settings are validated against an exposure model inside the node → no impossible exposures.
 *  - A writer node with hard word limits → shorter, clearer text (the word wall).
 */
export type Stage2Options = NodeCtx & { facts: ShootFacts };

export async function runStage2(req: PlanRequest, opts: Stage2Options): Promise<AgentResult> {
  const t0 = Date.now();
  const trace: TraceStep[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let modelCalls = 0;
  const ctx: NodeCtx = { create: opts.create, model: opts.model };

  async function node<T>(name: string, fn: () => Promise<StructuredResult<T>>): Promise<T> {
    const start = Date.now();
    try {
      const r = await fn();
      usage.inputTokens += r.usage.inputTokens;
      usage.outputTokens += r.usage.outputTokens;
      modelCalls += r.attempts;
      trace.push({ type: "node", name, kind: "model", ms: Date.now() - start, startedAtMs: start - t0, attempts: r.attempts, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens });
      return r.value;
    } catch (err) {
      trace.push({ type: "node", name, kind: "model", ms: Date.now() - start, startedAtMs: start - t0, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
  function codeStep<T>(name: string, fn: () => T): T {
    const start = Date.now();
    const v = fn();
    trace.push({ type: "node", name, kind: "code", ms: Date.now() - start, startedAtMs: start - t0 });
    return v;
  }

  try {
    const facts = opts.facts;
    const candidates = codeStep("windows + exposure", () => buildCandidates(req, facts));
    if (!candidates.length) throw new Error("No usable light windows on this date (the sun doesn't rise).");

    const light = await node("light", () => lightNode(ctx, req, facts, candidates));
    const chosen = light.windows.map((w) => candidates.find((c) => c.id === w.id)!) as CandidateWindow[];
    const best = chosen[0];

    const poseLib = poseCandidates(req, light.strategy);
    const [settings, poses] = await Promise.all([
      node("settings", () => settingsNode(ctx, req, facts, best, light)),
      node("poses", () => posesNode(ctx, req, light, poseLib)),
    ]);

    const orient = codeStep("orientation", () => orientation(light.strategy, best.sunAtMid.azimuthDeg));
    const poseObjs = poses.poses.map((p) => ({ lib: getPose(p.libraryId)!, cue: p.locationCue }));

    const text = await node("writer", () =>
      writerNode(ctx, { req, windows: chosen, light, orient, settings, poseNames: poseObjs.map((p) => p.lib.name), hasForecast: !!facts.weather }),
    );

    const plan = codeStep("assemble", (): ShotPlan =>
      ShotPlanSchema.parse({
        summary: text.summary,
        recommendedWindows: chosen.map((w, i) => ({
          start: w.start,
          end: w.end,
          // Daylight windows are only chosen with open shade (enforced by the light schema): say so in the label
          label: w.kind === "daylight" ? `${w.label}, in open shade` : w.label,
          why: text.windowWhy.find((x) => x.id === w.id)?.why ?? light.windows[i].why,
          rank: i + 1,
        })),
        lighting: {
          sunDirectionAtBestTime: { azimuthDeg: best.sunAtMid.azimuthDeg, compass: best.sunAtMid.compass },
          strategy: light.strategy,
          subjectPlacement: text.subjectPlacement,
          photographerPlacement: text.photographerPlacement,
          tips: text.tips,
        },
        settings: {
          mode: settings.mode,
          aperture: settings.aperture,
          ...(settings.focalLengthMm !== undefined ? { focalLengthMm: settings.focalLengthMm } : {}),
          shutterSpeed: settings.shutterSpeed,
          iso: settings.iso,
          ...(settings.exposureCompensation !== undefined ? { exposureCompensation: settings.exposureCompensation } : {}),
          focusMode: settings.focusMode,
          whiteBalance: settings.whiteBalance,
          why: text.settingsWhy,
        },
        poses: poseObjs.map(({ lib, cue }) => ({
          libraryId: lib.id,
          name: lib.name,
          instructions: cue ? [...lib.instructions, cue] : lib.instructions,
          bestFor: lib.bestFor,
        })),
        weatherCaveat: text.weatherCaveat,
        backupPlan: text.backupPlan,
        checklist: text.checklist,
      }),
    );

    return { plan, trace, usage, turns: modelCalls, model: opts.model };
  } catch (err) {
    throw new AgentError(err instanceof Error ? err.message : String(err), trace);
  }
}

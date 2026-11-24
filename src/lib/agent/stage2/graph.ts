import { orientation, type Orientation } from "../../orientation";
import { getPose } from "../../poses";
import { ShotPlanSchema, type PlanRequest, type ShootFacts, type ShotPlan } from "../../schema";
import { buildCandidates, settingsNoteFor, type CandidateWindow } from "../../windows";
import type { StructuredResult } from "../structured";
import { AgentError, type AgentResult, type TraceStep } from "../stage1";
import {
  lightNode,
  poseCandidates,
  posesNode,
  settingsNode,
  writerNode,
  type LightDecision,
  type NodeCtx,
  type PosesDecision,
  type Revision,
  type SettingsDecision,
  type WriterOutput,
} from "./nodes";

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
 *  - A writer node with word limits → shorter, clearer text.
 *
 * GraphRunner exposes each step so Stage 3 can re-run only the steps a reviewer flags.
 */
export type Stage2Options = NodeCtx & { facts: ShootFacts };

/** Everything one pass of the graph decided, so any step can be revised later. */
export type Draft = {
  light: LightDecision;
  chosen: CandidateWindow[];
  settings: SettingsDecision;
  poses: PosesDecision;
  text: WriterOutput;
  orient: Orientation;
  plan: ShotPlan;
};

export class GraphRunner {
  readonly trace: TraceStep[] = [];
  readonly usage = { inputTokens: 0, outputTokens: 0 };
  modelCalls = 0;
  private readonly t0 = Date.now();
  readonly ctx: NodeCtx;
  readonly facts: ShootFacts;
  candidates: CandidateWindow[] = [];

  constructor(
    readonly req: PlanRequest,
    readonly opts: Stage2Options,
  ) {
    this.ctx = { create: opts.create, model: opts.model };
    this.facts = opts.facts;
  }

  /** Run a model step, recording time, tokens, and attempts in the trace. */
  async node<T>(name: string, fn: () => Promise<StructuredResult<T>>, note?: (v: T) => string): Promise<T> {
    const start = Date.now();
    try {
      const r = await fn();
      this.usage.inputTokens += r.usage.inputTokens;
      this.usage.outputTokens += r.usage.outputTokens;
      this.modelCalls += r.attempts;
      this.trace.push({
        type: "node",
        name,
        kind: "model",
        ms: Date.now() - start,
        startedAtMs: start - this.t0,
        attempts: r.attempts,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        ...(note ? { note: note(r.value) } : {}),
      });
      return r.value;
    } catch (err) {
      this.trace.push({ type: "node", name, kind: "model", ms: Date.now() - start, startedAtMs: start - this.t0, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  codeStep<T>(name: string, fn: () => T): T {
    const start = Date.now();
    const v = fn();
    this.trace.push({ type: "node", name, kind: "code", ms: Date.now() - start, startedAtMs: start - this.t0 });
    return v;
  }

  prepare() {
    this.candidates = this.codeStep("windows + exposure", () => buildCandidates(this.req, this.facts));
    if (!this.candidates.length) throw new Error("No usable light windows on this date (the sun doesn't rise).");
  }

  chosenWindows(light: LightDecision): CandidateWindow[] {
    return light.windows.map((w) => this.candidates.find((c) => c.id === w.id)!);
  }

  light(label = "light", rev?: Revision) {
    return this.node(label, () => lightNode(this.ctx, this.req, this.facts, this.candidates, rev));
  }

  settings(light: LightDecision, label = "settings", rev?: Revision) {
    return this.node(label, () => settingsNode(this.ctx, this.req, this.facts, this.chosenWindows(light)[0], light, rev));
  }

  poses(light: LightDecision, label = "poses", rev?: Revision) {
    return this.node(label, () => posesNode(this.ctx, this.req, light, poseCandidates(this.req, light.strategy), rev));
  }

  orientation(light: LightDecision) {
    return this.codeStep("orientation", () => orientation(light.strategy, this.chosenWindows(light)[0].sunAtMid.azimuthDeg));
  }

  writer(parts: { light: LightDecision; settings: SettingsDecision; poses: PosesDecision; orient: Orientation }, label = "writer", rev?: Revision) {
    return this.node(label, () =>
      writerNode(this.ctx, {
        req: this.req,
        windows: this.chosenWindows(parts.light),
        light: parts.light,
        orient: parts.orient,
        settings: parts.settings,
        poseNames: parts.poses.poses.map((p) => getPose(p.libraryId)!.name),
        hasForecast: !!this.facts.weather,
        facts: this.facts,
        rev,
      }),
    );
  }

  assemble(parts: Omit<Draft, "plan" | "chosen">): Draft {
    const { light, settings, poses, text } = parts;
    const chosen = this.chosenWindows(light);
    const best = chosen[0];
    const lens = this.facts.gear.lens;
    const focal = settings.focalLengthMm ?? (Array.isArray(lens.focalMm) ? lens.focalMm[0] : lens.focalMm);
    const plan = this.codeStep("assemble", (): ShotPlan =>
      ShotPlanSchema.parse({
        summary: text.summary,
        recommendedWindows: chosen.map((w, i) => ({
          start: w.start,
          end: w.end,
          // Daylight windows are only chosen with open shade (enforced by the light schema): say so in the label
          label: w.kind === "daylight" ? `${w.label}, in open shade` : w.label,
          why: text.windowWhy.find((x) => x.id === w.id)?.why ?? light.windows[i].why,
          rank: i + 1,
          ...(i > 0 ? { settingsNote: settingsNoteFor(w, light.strategy, this.facts, focal, this.req.subjects, settings) } : {}),
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
          // In aperture priority the camera picks the shutter; the value is the slowest to allow
          shutterSpeed: settings.mode === "aperture_priority" ? `${settings.shutterSpeed} or faster` : settings.shutterSpeed,
          iso: settings.iso,
          ...(settings.exposureCompensation !== undefined ? { exposureCompensation: settings.exposureCompensation } : {}),
          focusMode: settings.focusMode,
          whiteBalance: settings.whiteBalance,
          why: text.settingsWhy,
        },
        poses: poses.poses.map((p) => {
          const lib = getPose(p.libraryId)!;
          return { libraryId: lib.id, name: lib.name, instructions: p.locationCue ? [...lib.instructions, p.locationCue] : lib.instructions, bestFor: lib.bestFor };
        }),
        weatherCaveat: text.weatherCaveat,
        backupPlan: text.backupPlan,
        checklist: text.checklist,
      }),
    );
    return { ...parts, chosen, plan };
  }

  /** One full pass: light → [settings ‖ poses] → orientation → writer → assemble. */
  async fullPass(): Promise<Draft> {
    this.prepare();
    const light = await this.light();
    const [settings, poses] = await Promise.all([this.settings(light), this.poses(light)]);
    const orient = this.orientation(light);
    const text = await this.writer({ light, settings, poses, orient });
    return this.assemble({ light, settings, poses, text, orient });
  }

  result(plan: ShotPlan, extra: Partial<AgentResult> = {}): AgentResult {
    return { plan, trace: this.trace, usage: this.usage, turns: this.modelCalls, model: this.opts.model, ...extra };
  }
}

export async function runStage2(req: PlanRequest, opts: Stage2Options): Promise<AgentResult> {
  const g = new GraphRunner(req, opts);
  try {
    const draft = await g.fullPass();
    return g.result(draft.plan);
  } catch (err) {
    throw new AgentError(err instanceof Error ? err.message : String(err), g.trace);
  }
}

import { z } from "zod";
import { fmtShutter, minShutter } from "../../exposure";
import { equivalentFocal, focalInRange, isZoom, maxApertureAt } from "../../gear";
import type { Orientation } from "../../orientation";
import { findPoses, type Pose } from "../../poses";
import { LightStrategy, type PlanRequest, type ShootFacts } from "../../schema";
import { exposureFor, type CandidateWindow } from "../../windows";
import { maxWords, structuredCall, type StructuredResult } from "../structured";
import type { CreateMessage } from "../stage1";

/**
 * Stage 2 nodes. Each model node makes ONE structured call with a narrow job and a schema
 * that encodes its rules. Numbers (times, angles, exposure) come from code, never from the model.
 */
export type NodeCtx = { create: CreateMessage; model: string };

const COMMON = `You are part of PerfectShot, a portrait-shoot planner for beginner photographers (outdoor, natural light).
Never state times, angles, or other numbers yourself unless they are given to you; the app inserts exact values.
Plain language for beginners. Safety first: never put people near cliff edges, on roads, or in water.`;

const subjectsText = (n: number) => (n === 4 ? "a group of 4+" : n === 1 ? "one person" : `${n} people`);

// ---------------------------------------------------------------- light
export function lightSchema(candidates: Pick<CandidateWindow, "id" | "kind">[]) {
  const ids = candidates.map((c) => c.id) as [string, ...string[]];
  const daylight = new Set(candidates.filter((c) => c.kind === "daylight").map((c) => c.id));
  return z
    .object({
      windows: z
        .array(
          z.object({
            id: z.enum(ids),
            why: maxWords(25),
            openShade: z.boolean().optional().describe("Required true for daylight windows (late_afternoon, your_window): the subject must be in open shade then."),
          }),
        )
        .min(1)
        .max(3)
        .describe("Best first. 1–3 windows chosen from the candidates by id."),
      strategy: LightStrategy,
      siteNotes: maxWords(45, "Where at this location to set up and what's behind the subject. Name real features if you know them. Flag terrain or buildings that may block low sun."),
      tips: z.array(maxWords(22)).max(3),
      weatherCaveat: maxWords(30),
      backupPlan: maxWords(35),
    })
    .refine((v) => new Set(v.windows.map((w) => w.id)).size === v.windows.length, { message: "Each window id may appear only once" })
    .superRefine((v, ctx) => {
      v.windows.forEach((w, i) => {
        if (daylight.has(w.id) && !w.openShade) {
          ctx.addIssue({ code: "custom", path: ["windows", i, "openShade"], message: `${w.id} is plain daylight: only use it with the subject in open shade (set openShade: true), or pick a golden/blue window instead.` });
        }
      });
    });
}
export type LightDecision = z.infer<ReturnType<typeof lightSchema>>;

export async function lightNode(ctx: NodeCtx, req: PlanRequest, facts: ShootFacts, candidates: CandidateWindow[]): Promise<StructuredResult<LightDecision>> {
  const user = [
    `Location: ${req.location.name ?? "unnamed spot"} (${req.location.lat}, ${req.location.lng}). Date: ${req.date}. Timezone: ${facts.timezone}.`,
    `Subjects: ${subjectsText(req.subjects)}.${req.vibe ? ` Vibe: ${req.vibe}.` : ""}${req.notes ? ` Photographer's notes: ${req.notes}` : ""}`,
    req.timeWindow ? `The photographer prefers ${req.timeWindow.start}–${req.timeWindow.end} local ("your_window"). Respect it if the light can work; otherwise explain the better option.` : "",
    facts.sun.lowSunAllDay ? "The sun stays very low all day here (no true golden hour): all of daylight has warm, low-angle light." : "",
    facts.weather ? "" : "No forecast is available for this date (too far ahead).",
    `Candidate windows (sun direction and height at each window's midpoint; brightness is EV, higher = brighter):`,
    JSON.stringify(candidates.map((c) => ({ id: c.id, label: c.label, local: c.local, sun: c.sunAtMid, weather: c.weather, brightness: c.brightness.label }))),
  ]
    .filter(Boolean)
    .join("\n");

  return structuredCall({
    ...ctx,
    system: `${COMMON}

Your job: decide WHEN to shoot and HOW to use the light. Pick 1–3 windows from the candidates (best first) and ONE light strategy for the best window:
- backlight: sun behind the subject (golden hour, rim light). Needs the sun above the horizon and not blocked.
- side_light: sun from the side, more shape and drama.
- front_light: sun behind the photographer. Only with a very low, soft sun; otherwise people squint.
- open_shade: subject just inside shade, facing open sky. Best when the light is harsh or the sun is high.
- overcast_soft: heavy cloud, soft light everywhere.
Prefer golden hour for warm portraits, blue hour for moody ones. Daylight windows (late_afternoon, your_window) are allowed ONLY with the subject in open shade (set openShade: true); never plan harsh direct sun on faces.
If buildings, trees, cliffs, or canyon walls may block a low sun at this spot, say so in siteNotes and choose accordingly.`,
    user,
    toolName: "submit_light",
    toolDescription: "Submit the timing and light decision.",
    schema: lightSchema(candidates),
    maxTokens: 2500,
  });
}

// ---------------------------------------------------------------- settings
export function settingsSchema(facts: ShootFacts, best: CandidateWindow, strategy: string, subjects: number) {
  const { body, lens } = facts.gear;
  return z
    .object({
      mode: z.enum(["aperture_priority", "manual"]),
      focalLengthMm: z.number().optional().describe(isZoom(lens) ? "Required: the focal length to zoom to." : "Omit for prime lenses."),
      aperture: z.number(),
      shutterSpeed: z.string().regex(/^1\/\d+$/, "Use the form 1/250").describe("In aperture priority: the slowest shutter to allow (set as Auto ISO minimum shutter)."),
      iso: z.union([z.number().int(), z.literal("auto")]),
      exposureCompensation: z.number().min(-3).max(3).optional(),
      focusMode: maxWords(10),
      whiteBalance: maxWords(8),
      why: maxWords(35),
    })
    .superRefine((s, ctx) => {
      const issue = (message: string, path: string) => ctx.addIssue({ code: "custom", message, path: [path] });
      if (isZoom(lens) && s.focalLengthMm === undefined) return issue(`${lens.name} is a zoom: set focalLengthMm`, "focalLengthMm");
      if (s.focalLengthMm !== undefined && !focalInRange(lens, s.focalLengthMm)) return issue(`${s.focalLengthMm}mm is outside this lens's range`, "focalLengthMm");
      const widest = maxApertureAt(lens, s.focalLengthMm);
      if (s.aperture < widest) issue(`f/${s.aperture} is wider than this lens allows (f/${widest})`, "aperture");
      if (s.iso !== "auto" && s.iso > body.maxUsableIso) issue(`ISO ${s.iso} is above this camera's usable limit (${body.maxUsableIso})`, "iso");
      if (s.mode === "manual" && s.iso !== "auto" && s.exposureCompensation) issue("Exposure compensation does nothing in manual mode with a fixed ISO. Use Auto ISO or drop it.", "exposureCompensation");
      // Can this combination actually expose correctly in this light?
      const focal = s.focalLengthMm ?? (Array.isArray(lens.focalMm) ? lens.focalMm[0] : lens.focalMm);
      const ev = exposureFor(best, strategy, facts, focal, subjects).ev;
      const t = 1 / Number(s.shutterSpeed.split("/")[1]);
      const isoNeeded = (100 * s.aperture * s.aperture) / t / 2 ** ev;
      const bestCase = (100 * widest * widest) / minShutter(body, lens, focal, subjects) / 2 ** ev;
      if (isoNeeded > body.maxUsableIso * 1.3 && bestCase <= body.maxUsableIso) {
        issue(`At f/${s.aperture} and ${s.shutterSpeed} this light needs about ISO ${Math.round(isoNeeded)}, above the usable ${body.maxUsableIso}. Use a wider aperture or a slower (but safe) shutter.`, "aperture");
      }
    });
}
export type SettingsDecision = z.infer<ReturnType<typeof settingsSchema>>;

export async function settingsNode(ctx: NodeCtx, req: PlanRequest, facts: ShootFacts, best: CandidateWindow, light: LightDecision): Promise<StructuredResult<SettingsDecision>> {
  const { body, lens } = facts.gear;
  const focals = Array.isArray(lens.focalMm) ? [lens.focalMm[0], Math.round((lens.focalMm[0] + lens.focalMm[1]) / 2), lens.focalMm[1]] : [lens.focalMm];
  const table = focals.map((f) => ({ focalMm: f, fullFrameEquivalentMm: equivalentFocal(f, body), widestAperture: maxApertureAt(lens, f), ...exposureFor(best, light.strategy, facts, f, req.subjects) }));
  const user = [
    `Camera: ${body.name} (${body.sensor}; usable ISO up to ${body.maxUsableIso}; in-body stabilization: ${body.ibis ? "yes" : "no"}; eye AF: ${body.eyeAf ? "yes" : "no"}).`,
    `Lens: ${lens.name} (stabilized: ${lens.stabilized ? "yes" : "no"}).`,
    `Shooting: ${best.label} (${best.local}), strategy ${light.strategy}, ${subjectsText(req.subjects)}${req.vibe ? `, vibe ${req.vibe}` : ""}.`,
    `Computed exposure options at the minimum safe shutter for this light (ISO needed; withinIsoLimit=false means too dark at that aperture):`,
    JSON.stringify(table),
  ].join("\n");
  return structuredCall({
    ...ctx,
    system: `${COMMON}

Your job: choose starting camera settings that this exact camera and lens can achieve in this light.
- Prefer aperture priority with Auto ISO for beginners; the shutterSpeed is then the slowest shutter to allow.
- Keep enough depth of field: about f/2–2.8 for one person, f/2.8–4 for two, f/4–5.6 for groups.
- Use the exposure table. Don't pick a combination that needs more ISO than the camera can use.
- Backlight usually needs +0.3 to +1 exposure compensation to keep faces bright.
- "why" explains the choice in plain words, one idea per sentence.`,
    user,
    toolName: "submit_settings",
    toolDescription: "Submit the camera settings.",
    schema: settingsSchema(facts, best, light.strategy, req.subjects),
    maxTokens: 1500,
  });
}

// ---------------------------------------------------------------- poses
export function posesSchema(ids: [string, ...string[]]) {
  return z
    .object({
      poses: z
        .array(z.object({ libraryId: z.enum(ids), locationCue: maxWords(15, "Optional: one extra spoken cue tailored to this spot.").optional() }))
        .min(3)
        .max(5),
    })
    .refine((v) => new Set(v.poses.map((p) => p.libraryId)).size === v.poses.length, { message: "Each pose only once" });
}
export type PosesDecision = z.infer<ReturnType<typeof posesSchema>>;

export function poseCandidates(req: PlanRequest, strategy: z.infer<typeof LightStrategy>): Pose[] {
  return findPoses({ subjects: req.subjects, light: strategy, vibe: req.vibe, limit: 10 });
}

export async function posesNode(ctx: NodeCtx, req: PlanRequest, light: LightDecision, candidates: Pose[]): Promise<StructuredResult<PosesDecision>> {
  return structuredCall({
    ...ctx,
    system: `${COMMON}

Your job: pick 3–5 poses from the library that suit the light, the subjects, and the place. Order them as a natural flow for the shoot (easy warm-up first).`,
    user: [
      `Subjects: ${subjectsText(req.subjects)}. Light strategy: ${light.strategy}. Site: ${light.siteNotes}${req.vibe ? ` Vibe: ${req.vibe}.` : ""}`,
      `Library:`,
      JSON.stringify(candidates.map((p) => ({ id: p.id, name: p.name, light: p.light, vibes: p.vibes, bestFor: p.bestFor }))),
    ].join("\n"),
    toolName: "submit_poses",
    toolDescription: "Submit the chosen poses.",
    schema: posesSchema(candidates.map((p) => p.id) as [string, ...string[]]),
    maxTokens: 1000,
  });
}

// ---------------------------------------------------------------- writer
export function writerSchema(windowIds: [string, ...string[]]) {
  return z.object({
    summary: maxWords(40),
    windowWhy: z.array(z.object({ id: z.enum(windowIds), why: maxWords(20) })),
    subjectPlacement: maxWords(30),
    photographerPlacement: maxWords(30),
    tips: z.array(maxWords(20)).max(3),
    settingsWhy: maxWords(30),
    weatherCaveat: maxWords(25),
    backupPlan: maxWords(30),
    checklist: z.array(maxWords(8)).min(3).max(5),
  });
}
export type WriterOutput = z.infer<ReturnType<typeof writerSchema>>;

export async function writerNode(
  ctx: NodeCtx,
  input: {
    req: PlanRequest;
    windows: CandidateWindow[];
    light: LightDecision;
    orient: Orientation;
    settings: SettingsDecision;
    poseNames: string[];
    hasForecast: boolean;
  },
): Promise<StructuredResult<WriterOutput>> {
  const { req, windows, light, orient, settings } = input;
  const s = settings;
  return structuredCall({
    ...ctx,
    system: `${COMMON}

Your job: write the final plan text. Short, clear, and consistent. A beginner should be able to act on it while standing on location.
- Use the decisions given. Do not change them or add new ones.
- The ORIENTATION sentence is the source of truth for where everyone stands. Never contradict it.
- Only use times exactly as given in "local" labels. No other numbers except camera settings provided.
- One idea per sentence. Explain any photo term in a few words the first time (e.g. "backlight (sun behind them)").
- Every field states its word limit ("At most N words"). Stay under it; shorter is better.`,
    user: JSON.stringify({
      place: req.location.name ?? "this spot",
      subjects: subjectsText(req.subjects),
      chosenWindows: windows.map((w) => ({ id: w.id, label: w.label, local: w.local, plannerReason: light.windows.find((x) => x.id === w.id)?.why })),
      strategy: light.strategy,
      ORIENTATION: orient.sentence,
      siteNotes: light.siteNotes,
      draftTips: light.tips,
      settings: { mode: s.mode, aperture: `f/${s.aperture}`, shutter: s.shutterSpeed, iso: s.iso, exposureCompensation: s.exposureCompensation, focalLengthMm: s.focalLengthMm, plannerReason: s.why },
      poses: input.poseNames,
      forecastAvailable: input.hasForecast,
      draftWeatherCaveat: light.weatherCaveat,
      draftBackupPlan: light.backupPlan,
    }),
    toolName: "submit_text",
    toolDescription: "Submit the final plan text.",
    schema: writerSchema(windows.map((w) => w.id) as [string, ...string[]]),
    maxTokens: 2500,
  });
}

export { fmtShutter };

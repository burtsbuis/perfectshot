import * as SunCalc from "suncalc";
import { focalInRange, isZoom, maxApertureAt } from "./gear";
import { getPose } from "./poses";
import { ShotPlanSchema, type PlanRequest, type ShootFacts, type ShotPlan } from "./schema";

/**
 * Deterministic rule checks run on every agent output (see docs/spec.md).
 * They catch the failure modes LLMs are prone to: impossible settings, sun direction that
 * doesn't match the astronomy, and ignoring the forecast.
 */
export type CheckStatus = "pass" | "fail" | "skip";
export type CheckResult = { id: string; status: CheckStatus; message: string };

const AZIMUTH_TOLERANCE_DEG = 10;
const RAIN_THRESHOLD_PCT = 50;

const ms = (iso: string) => Date.parse(iso);
const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) =>
  ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);
export const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

export function runChecks(plan: unknown, req: PlanRequest, facts: ShootFacts): CheckResult[] {
  const results: CheckResult[] = [];
  const add = (id: string, status: CheckStatus, message: string) => results.push({ id, status, message });

  // 1. Schema
  const parsed = ShotPlanSchema.safeParse(plan);
  if (!parsed.success) {
    add("schema", "fail", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return results; // the other checks need a well-formed plan
  }
  add("schema", "pass", "Plan matches the ShotPlan schema");
  const p: ShotPlan = parsed.data;
  const { body, lens } = facts.gear;

  // 2. Aperture is physically possible on this lens (at the stated focal length for zooms)
  const focal = p.settings.focalLengthMm;
  if (isZoom(lens) && focal === undefined) {
    add("aperture", "fail", `${lens.name} is a zoom: settings.focalLengthMm is required`);
  } else if (focal !== undefined && !focalInRange(lens, focal)) {
    add("aperture", "fail", `${focal}mm is outside the range of ${lens.name}`);
  } else {
    const widest = maxApertureAt(lens, focal);
    if (p.settings.aperture < widest) {
      add("aperture", "fail", `f/${p.settings.aperture} is wider than this lens allows (f/${widest}${focal ? ` at ${focal}mm` : ""})`);
    } else add("aperture", "pass", `f/${p.settings.aperture} is valid (widest f/${widest})`);
  }

  // 3. ISO within the body's usable range
  if (p.settings.iso === "auto") add("iso", "pass", "Auto ISO");
  else if (p.settings.iso > body.maxUsableIso) add("iso", "fail", `ISO ${p.settings.iso} exceeds ${body.name}'s usable max of ${body.maxUsableIso}`);
  else add("iso", "pass", `ISO ${p.settings.iso} ≤ ${body.maxUsableIso}`);

  // 4. Recommended windows line up with real light windows (or are explicitly shade/overcast)
  const sunWindows = [
    facts.sun.goldenHourMorning,
    facts.sun.goldenHourEvening,
    facts.sun.blueHourMorning,
    facts.sun.blueHourEvening,
  ].filter((w): w is { start: string; end: string } => w !== null);
  const badWindows = p.recommendedWindows.filter(
    (w) => !sunWindows.some((s) => overlaps(w, s)) && !/shade|overcast|cloud/i.test(`${w.label} ${w.why}`),
  );
  if (badWindows.length) add("windows", "fail", `Not near golden/blue hour and not marked shade/overcast: ${badWindows.map((w) => w.label).join(", ")}`);
  else add("windows", "pass", "All windows match computed light windows or are marked shade/overcast");

  // 5. Stated sun direction matches the astronomy at the best window's midpoint
  const best = [...p.recommendedWindows].sort((a, b) => a.rank - b.rank)[0];
  const mid = new Date((ms(best.start) + ms(best.end)) / 2);
  const pos = SunCalc.getPosition(mid, req.location.lat, req.location.lng);
  if (pos.altitude < -6 || /shade|overcast/.test(p.lighting.strategy)) {
    add("sun_direction", "skip", "Sun below the horizon or a diffuse-light strategy; direction not critical");
  } else {
    const diff = angleDiff(p.lighting.sunDirectionAtBestTime.azimuthDeg, pos.azimuth);
    if (diff > AZIMUTH_TOLERANCE_DEG) add("sun_direction", "fail", `Stated ${p.lighting.sunDirectionAtBestTime.azimuthDeg}° but the sun is at ${pos.azimuth.toFixed(0)}° (off by ${diff.toFixed(0)}°)`);
    else add("sun_direction", "pass", `Within ${diff.toFixed(0)}° of the computed azimuth`);
  }

  // 6. Poses suit the subject count (library poses are verified; custom poses are allowed)
  const unsuited = p.poses.filter((x) => {
    if (!x.libraryId) return false;
    const lib = getPose(x.libraryId);
    return !lib || !lib.subjects.includes(req.subjects);
  });
  if (unsuited.length) add("poses", "fail", `Unknown or wrong-size poses: ${unsuited.map((x) => x.libraryId).join(", ")}`);
  else add("poses", "pass", `${p.poses.length} poses suit ${req.subjects} subject(s)`);

  // 7. Rain in the forecast → the plan must say so and have a backup
  const hours = facts.weather?.hourly ?? [];
  const inWindows = hours.filter((h) => p.recommendedWindows.some((w) => ms(h.time) >= ms(w.start) - 3600_000 && ms(h.time) <= ms(w.end)));
  if (!inWindows.length) {
    add("rain", "skip", "No forecast for the recommended windows");
  } else {
    const maxRain = Math.max(...inWindows.map((h) => h.precipProbPct));
    if (maxRain <= RAIN_THRESHOLD_PCT) add("rain", "pass", `Max rain chance ${maxRain}%`);
    else if (/rain|shower|wet|drizzle/i.test(p.weatherCaveat) && p.backupPlan.trim().length > 0) add("rain", "pass", `Rain ${maxRain}% acknowledged with a backup plan`);
    else add("rain", "fail", `Rain chance ${maxRain}% but the caveat/backup doesn't address it`);
  }

  // 8. Settings don't contradict themselves.
  //    Exposure compensation does nothing in full manual (fixed ISO); it works in manual with Auto ISO.
  const st = p.settings;
  if (st.mode === "manual" && st.iso !== "auto" && st.exposureCompensation !== undefined && st.exposureCompensation !== 0) {
    add("settings_consistency", "fail", `Exposure compensation ${st.exposureCompensation} has no effect in manual mode with fixed ISO ${st.iso}`);
  } else {
    add("settings_consistency", "pass", "Mode, ISO, and exposure compensation are consistent");
  }

  return results;
}

export const allPassed = (r: CheckResult[]) => r.every((c) => c.status !== "fail");

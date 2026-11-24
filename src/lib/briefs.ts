import type { ShootFacts, ShotPlan } from "./schema";
import { compassLabel } from "./sun";

/**
 * Compact, human-readable views of facts and plans, shared by the evaluation judge and the
 * Stage 3 critic, so both reason about the same thing the user sees.
 */

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
      ? hours
          .filter((_, i) => i % 2 === 0)
          .map((h) => `${t(h.time)}: ${h.cloudCoverPct}% cloud, ${h.precipProbPct}% rain, ${Math.round(h.tempC)}°C, wind ${Math.round(h.windKph)} km/h`)
      : "No forecast (date too far ahead)",
    ...(facts.sun.lowSunAllDay ? { lowSunAllDay: "The sun never climbs above ~6° today: all of daylight has golden-hour-quality light, so there's no separate golden hour." } : {}),
    blueHourMorning: win(facts.sun.blueHourMorning),
    blueHourEvening: win(facts.sun.blueHourEvening),
    gear: `${facts.gear.body.name} (${facts.gear.body.sensor}, in-body stabilization: ${facts.gear.body.ibis ? "yes" : "no"}, usable ISO up to ${facts.gear.body.maxUsableIso}) + ${facts.gear.lens.name} (lens stabilization: ${facts.gear.lens.stabilized ? "yes" : "no"})`,
  };
}

/**
 * The plan as a user sees it on the page: times converted to the location's local time
 * (the stored ISO UTC values are an implementation detail the judge shouldn't grade), and the
 * meaning of the shutter value spelled out per mode.
 */
export function planForJudge(plan: ShotPlan, timezone: string) {
  const t = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  return {
    ...plan,
    recommendedWindows: plan.recommendedWindows.map(({ start, end, ...w }) => ({ ...w, shownToUserAs: `${t(start)}–${t(end)}` })),
    settings: {
      ...plan.settings,
      shutterMeaning:
        plan.settings.mode === "aperture_priority"
          ? "In aperture priority the camera sets the shutter; this value is the slowest shutter to allow (Auto ISO minimum shutter)."
          : "Manual mode: set this shutter speed.",
    },
  };
}

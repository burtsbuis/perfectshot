import * as SunCalc from "suncalc";
import { exposureOptions, subjectEv, brightnessLabel } from "./exposure";
import type { PlanRequest, ShootFacts } from "./schema";
import { compassLabel } from "./sun";

/**
 * Candidate time windows, computed by code. The light node picks from these by id, so it can't
 * invent or mistype times (Stage 1's most common failure).
 */
export type CandidateWindow = {
  id: string;
  kind: "golden" | "blue" | "low_sun" | "daylight";
  label: string;
  start: string;
  end: string;
  local: string;
  sunAtMid: { azimuthDeg: number; altitudeDeg: number; compass: string };
  weather: { cloudPct: number; rainPct: number } | null;
  /** Estimated subject brightness by lighting approach (EV100) */
  brightness: { direct: number; backlitFace: number; shade: number; label: string };
};

const ms = Date.parse;

function localRange(start: string, end: string, tz: string) {
  const t = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return `${t(start)}–${t(end)}`;
}

/** Local "HH:mm" on the request date → ISO, using the facts' timezone offset at that moment. */
function localTimeToIso(date: string, hhmm: string, tz: string): string {
  const guess = Date.parse(`${date}T${hhmm}:00Z`);
  const asLocal = new Date(new Date(guess).toLocaleString("en-US", { timeZone: tz })).getTime();
  const asUtc = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(guess - (asLocal - asUtc)).toISOString();
}

export function buildCandidates(req: PlanRequest, facts: ShootFacts): CandidateWindow[] {
  const s = facts.sun;
  const raw: { id: string; kind: CandidateWindow["kind"]; label: string; start: string; end: string }[] = [];
  if (s.blueHourMorning) raw.push({ id: "blue_morning", kind: "blue", label: "Morning blue hour", ...s.blueHourMorning });
  if (s.goldenHourMorning) raw.push({ id: "golden_morning", kind: "golden", label: "Morning golden hour", ...s.goldenHourMorning });
  if (s.lowSunAllDay && s.sunrise && s.sunset) raw.push({ id: "low_sun_day", kind: "low_sun", label: "Low sun all day", start: s.sunrise, end: s.sunset });
  if (s.goldenHourEvening) {
    const lateStart = new Date(ms(s.goldenHourEvening.start) - 90 * 60_000).toISOString();
    if (!s.goldenHourMorning || ms(lateStart) > ms(s.goldenHourMorning.end)) {
      raw.push({ id: "late_afternoon", kind: "daylight", label: "Late afternoon (before golden hour)", start: lateStart, end: s.goldenHourEvening.start });
    }
    raw.push({ id: "golden_evening", kind: "golden", label: "Evening golden hour", ...s.goldenHourEvening });
  }
  if (s.blueHourEvening) raw.push({ id: "blue_evening", kind: "blue", label: "Evening blue hour", ...s.blueHourEvening });
  if (req.timeWindow) {
    raw.push({
      id: "your_window",
      kind: "daylight",
      label: "Your preferred time",
      start: localTimeToIso(req.date, req.timeWindow.start, facts.timezone),
      end: localTimeToIso(req.date, req.timeWindow.end, facts.timezone),
    });
  }

  const hours = facts.weather?.hourly ?? [];
  return raw
    .filter((w) => ms(w.end) > ms(w.start))
    .map((w) => {
      const mid = new Date((ms(w.start) + ms(w.end)) / 2);
      const pos = SunCalc.getPosition(mid, req.location.lat, req.location.lng);
      const inWin = hours.filter((h) => ms(h.time) + 3600_000 > ms(w.start) && ms(h.time) < ms(w.end));
      const weather = inWin.length
        ? { cloudPct: Math.round(inWin.reduce((a, h) => a + h.cloudCoverPct, 0) / inWin.length), rainPct: Math.max(...inWin.map((h) => h.precipProbPct)) }
        : null;
      const cloud = weather?.cloudPct ?? 30;
      const direct = subjectEv(pos.altitude, cloud, "direct");
      return {
        ...w,
        local: localRange(w.start, w.end, facts.timezone),
        sunAtMid: { azimuthDeg: Math.round(pos.azimuth), altitudeDeg: Math.round(pos.altitude * 10) / 10, compass: compassLabel(pos.azimuth) },
        weather,
        brightness: {
          direct: round1(direct),
          backlitFace: round1(subjectEv(pos.altitude, cloud, "backlit_face")),
          shade: round1(subjectEv(pos.altitude, cloud, "shade")),
          label: brightnessLabel(direct),
        },
      };
    });
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Exposure options for one window + strategy (what the settings node chooses from). */
export function exposureFor(win: CandidateWindow, strategy: string, facts: ShootFacts, focalMm: number, subjects: number) {
  const ev =
    strategy === "backlight" ? win.brightness.backlitFace : strategy === "open_shade" ? win.brightness.shade : strategy === "overcast_soft" ? win.brightness.direct - 0.5 : win.brightness.direct;
  return { ev: round1(ev), ...exposureOptions(ev, facts.gear.body, facts.gear.lens, focalMm, subjects) };
}

import * as SunCalc from "suncalc";
import type { SunFacts } from "./schema";

// Note: SunCalc v2 returns azimuth in degrees clockwise from north and
// refraction-corrected altitude in degrees (v1 used radians from south).

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export function compassLabel(deg: number): string {
  return POINTS[Math.round(deg / 22.5) % 16];
}

// SunCalc v2 returns null for events that don't happen (polar day/night)
const iso = (d: Date | null) => (d && !isNaN(d.getTime()) ? d.toISOString() : null);
const win = (a: Date | null, b: Date | null) => {
  const start = iso(a);
  const end = iso(b);
  return start && end ? { start, end } : null;
};

/**
 * Compute sun facts for a date at a location.
 * `date` is "YYYY-MM-DD"; we sample at local solar noon so SunCalc returns the right day's events.
 * Times are returned as UTC ISO strings; the UI converts them to the location's timezone.
 */
export function getSunFacts(lat: number, lng: number, date: string, stepMinutes = 15): SunFacts {
  // Approximate local solar noon in UTC: 12:00 minus longitude offset
  const [y, m, d] = date.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0) - (lng / 15) * 3600_000);
  const t = SunCalc.getTimes(noonUtc, lat, lng);

  // Sample positions from 1h before sunrise to 1h after sunset (or the whole day at the poles)
  const rise = iso(t.sunrise);
  const set = iso(t.sunset);
  const start = rise ? new Date(Date.parse(rise) - 3600_000) : new Date(noonUtc.getTime() - 12 * 3600_000);
  const end = set ? new Date(Date.parse(set) + 3600_000) : new Date(noonUtc.getTime() + 12 * 3600_000);

  const positions: SunFacts["positions"] = [];
  for (let ms = start.getTime(); ms <= end.getTime(); ms += stepMinutes * 60_000) {
    const p = SunCalc.getPosition(new Date(ms), lat, lng);
    positions.push({
      time: new Date(ms).toISOString(),
      azimuthDeg: Math.round(p.azimuth * 10) / 10,
      altitudeDeg: Math.round(p.altitude * 10) / 10,
    });
  }

  return {
    sunrise: rise,
    sunset: set,
    // SunCalc: goldenHourEnd = morning golden hour end; goldenHour = evening golden hour start
    goldenHourMorning: win(t.sunrise, t.goldenHourEnd),
    goldenHourEvening: win(t.goldenHour, t.sunset),
    // Blue hour = civil twilight (sun 0° to -6°), right next to golden hour. An earlier version
    // used -6° to -12°, which is too dark and too late for portraits (ADR-015).
    blueHourMorning: win(t.dawn, t.sunrise),
    blueHourEvening: win(t.sunset, t.dusk),
    positions,
  };
}

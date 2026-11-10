import type { PlanRequest, ShotPlan } from "../schema";
import { getSunFacts } from "../sun";

/** Eval scenario #1: Baker Beach, Nov 20, a6400 + 35mm f/1.8, couple */
export const bakerReq: PlanRequest = {
  location: { lat: 37.7936, lng: -122.4836, name: "Baker Beach, San Francisco" },
  date: "2026-11-20",
  gear: { bodyId: "sony-a6400", lensId: "sony-e-35-f18" },
  subjects: 2,
};

/** Fake Open-Meteo: rain probability set by `rainPct`, 24 local hours, UTC-8 */
export function fakeOpenMeteo(rainPct = 10): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = new URL(String(url));
    const date = u.searchParams.get("start_date");
    const base = { timezone: "America/Los_Angeles", utc_offset_seconds: -28800 };
    if (!date) return new Response(JSON.stringify(base));
    const time = Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, "0")}:00`);
    return new Response(
      JSON.stringify({
        ...base,
        hourly: {
          time,
          cloud_cover: time.map(() => 20),
          precipitation_probability: time.map(() => rainPct),
          temperature_2m: time.map(() => 14),
          wind_speed_10m: time.map(() => 12),
        },
      }),
    );
  }) as typeof fetch;
}

/** A plan that should pass every check for bakerReq. */
export function goodBakerPlan(): ShotPlan {
  const sun = getSunFacts(bakerReq.location.lat, bakerReq.location.lng, bakerReq.date);
  const gh = sun.goldenHourEvening!;
  const mid = new Date((Date.parse(gh.start) + Date.parse(gh.end)) / 2).toISOString();
  const az = sun.positions.reduce((best, p) =>
    Math.abs(Date.parse(p.time) - Date.parse(mid)) < Math.abs(Date.parse(best.time) - Date.parse(mid)) ? p : best,
  ).azimuthDeg;
  return {
    summary: "Shoot during evening golden hour with the sun behind the couple over the ocean.",
    recommendedWindows: [{ start: gh.start, end: gh.end, label: "Evening golden hour", why: "Warm, low sun over the water", rank: 1 }],
    lighting: {
      sunDirectionAtBestTime: { azimuthDeg: az, compass: "WSW" },
      strategy: "backlight",
      subjectPlacement: "Couple faces ENE with the sun behind them",
      photographerPlacement: "Stand on the dune side, facing the ocean",
      tips: ["Expose for skin; let the sky go bright"],
    },
    settings: {
      mode: "aperture_priority",
      aperture: 2.2,
      shutterSpeed: "1/500",
      iso: "auto",
      exposureCompensation: 0.7,
      focusMode: "AF-C, eye AF",
      whiteBalance: "Cloudy",
      why: "Wide enough to blur the background while keeping both faces sharp",
    },
    poses: [
      { libraryId: "c-forehead-touch", name: "Forehead touch", instructions: ["Touch foreheads"], bestFor: "Rim light" },
      { libraryId: "c-walk-hands", name: "Hand-in-hand walk", instructions: ["Walk toward me"], bestFor: "Candids" },
      { name: "Wave chase", instructions: ["Run from the waves"], bestFor: "Fun" },
    ],
    weatherCaveat: "Fog can roll in; check the forecast that morning.",
    backupPlan: "If foggy, shoot soft-light close-ups by the cypress trees.",
    checklist: ["Charge batteries"],
  };
}

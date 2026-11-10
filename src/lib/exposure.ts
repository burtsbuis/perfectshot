import { equivalentFocal, maxApertureAt } from "./gear";
import type { Body, Lens } from "./schema";

/**
 * Rough exposure model (deterministic, so the LLM never guesses whether a shutter speed is possible).
 *
 * Scene brightness as EV100 (EV at ISO 100) from sun altitude and cloud cover, anchored to
 * photographic rules of thumb: "sunny 16" ≈ EV 15 with a high sun, ≈ EV 11–12 at sunset,
 * ≈ EV 5 at the end of civil twilight, open shade ≈ 3 stops below direct sun.
 * It's an estimate (±1 stop); the plan still tells people to check their screen.
 */
export type LightKind = "direct" | "backlit_face" | "shade" | "overcast";

const DAY_CURVE: [number, number][] = [
  [0, 11.5],
  [5, 13],
  [15, 14],
  [30, 15],
  [90, 15.3],
];

function interp(points: [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x0, y0] = points[i - 1];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return points.at(-1)![1];
}

/** EV100 of light falling on the subject's face. */
export function subjectEv(altitudeDeg: number, cloudPct: number, kind: LightKind): number {
  if (altitudeDeg < 0) return Math.max(2, 11.5 + altitudeDeg * 1.1); // twilight: everything is shade-like
  const cloud = Math.min(100, Math.max(0, cloudPct)) / 100;
  const direct = interp(DAY_CURVE, altitudeDeg) - 2 * cloud ** 1.5;
  const shadeDrop = 3 - 2 * cloud; // under cloud, shade and sun converge
  switch (kind) {
    case "direct":
      return direct;
    case "overcast":
      return direct - 0.5;
    case "backlit_face":
      return direct - Math.max(1, shadeDrop - 1); // face lit by sky and reflected light
    case "shade":
      return direct - Math.max(0.5, shadeDrop);
  }
}

const SHUTTERS = [1 / 60, 1 / 80, 1 / 100, 1 / 125, 1 / 160, 1 / 200, 1 / 250, 1 / 320, 1 / 400, 1 / 500, 1 / 640, 1 / 800, 1 / 1000, 1 / 2000, 1 / 4000];
const ISOS = [100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800];
export const fmtShutter = (t: number) => (t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}`);

/** Slowest sensible shutter for people: motion needs ~1/160 (1/250 for groups or movement); shake needs 1/(equivalent focal), halved without stabilization. */
export function minShutter(body: Body, lens: Lens, focalMm: number, subjects: number): number {
  const eq = equivalentFocal(focalMm, body);
  const shake = body.ibis || lens.stabilized ? 1 / eq : 1 / (2 * eq);
  const motion = subjects >= 3 ? 1 / 250 : 1 / 160;
  return Math.min(shake, motion);
}

export type ExposureOption = { aperture: number; shutter: string; iso: number; isoRaw: number; withinIsoLimit: boolean };

/**
 * For each sensible aperture, the ISO needed at the minimum shutter speed (rounded up to a
 * standard step, floored at 100: if ISO 100 is plenty, the shutter can simply go faster).
 */
export function exposureOptions(ev: number, body: Body, lens: Lens, focalMm: number, subjects: number): {
  minShutter: string;
  options: ExposureOption[];
} {
  const widest = maxApertureAt(lens, focalMm);
  const apertures = [...new Set([widest, 2, 2.8, 4, 5.6].filter((a) => a >= widest))].sort((a, b) => a - b).slice(0, 4);
  const tMin = minShutter(body, lens, focalMm, subjects);
  const shutter = SHUTTERS.filter((s) => s <= tMin + 1e-9)[0] ?? tMin; // nearest standard speed at or faster than the minimum
  return {
    minShutter: fmtShutter(shutter),
    options: apertures.map((N) => {
      const isoRaw = (100 * (N * N)) / shutter / 2 ** ev;
      const iso = ISOS.find((i) => i >= isoRaw) ?? Math.round(isoRaw);
      return { aperture: N, shutter: fmtShutter(shutter), iso: Math.max(100, iso), isoRaw: Math.round(isoRaw), withinIsoLimit: isoRaw <= body.maxUsableIso };
    }),
  };
}

/** Plain-language brightness label for an EV value. */
export function brightnessLabel(ev: number): string {
  if (ev >= 14) return "bright";
  if (ev >= 11.5) return "moderate";
  if (ev >= 9) return "dim";
  if (ev >= 6) return "low";
  return "very low";
}

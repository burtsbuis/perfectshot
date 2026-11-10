import { z } from "zod";
import gearData from "../../data/gear.json";
import { BodySchema, LensSchema, type Body, type Lens } from "./schema";

export const BODIES: Body[] = z.array(BodySchema).parse(gearData.bodies);
export const LENSES: Lens[] = z.array(LensSchema).parse(gearData.lenses);

export const getBody = (id: string) => BODIES.find((b) => b.id === id);
export const getLens = (id: string) => LENSES.find((l) => l.id === id);

export function lensesForBody(body: Body): Lens[] {
  return LENSES.filter((l) => l.mounts.includes(body.mount));
}

export const isZoom = (lens: Lens) => Array.isArray(lens.focalMm);

/** Full-frame-equivalent focal length. */
export function equivalentFocal(focalMm: number, body: Body): number {
  const crop = body.sensor === "FF" ? 1 : body.sensor === "MFT" ? 2 : body.brand === "Canon" ? 1.6 : 1.5;
  return Math.round(focalMm * crop);
}

/**
 * Widest aperture available at a focal length.
 * Variable-aperture zooms are linearly interpolated between the wide and tele ends and rounded
 * *up* to 0.1 (conservative). With no focal length given, the tele-end value is used, which is
 * valid at every focal length.
 */
export function maxApertureAt(lens: Lens, focalMm?: number): number {
  if (!Array.isArray(lens.maxAperture)) return lens.maxAperture;
  const [wideF, teleF] = lens.maxAperture;
  if (focalMm === undefined || !Array.isArray(lens.focalMm)) return teleF;
  const [wideMm, teleMm] = lens.focalMm;
  const t = Math.min(1, Math.max(0, (focalMm - wideMm) / (teleMm - wideMm)));
  return Math.ceil((wideF + t * (teleF - wideF)) * 10) / 10;
}

export function focalInRange(lens: Lens, focalMm: number): boolean {
  if (!Array.isArray(lens.focalMm)) return focalMm === lens.focalMm;
  return focalMm >= lens.focalMm[0] && focalMm <= lens.focalMm[1];
}

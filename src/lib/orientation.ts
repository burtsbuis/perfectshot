import type { ShotPlan } from "./schema";
import { compassLabel } from "./sun";

/**
 * Where the subject and photographer go, derived from the light strategy and the sun's azimuth.
 * Same geometry as the SunCompass diagram, so the words and the picture can never disagree.
 */
type Strategy = ShotPlan["lighting"]["strategy"];

export const CAMERA_OFFSET: Record<Strategy, number> = {
  backlight: 180,
  side_light: 90,
  front_light: 0,
  open_shade: 180,
  overcast_soft: 180,
};

export type Orientation = {
  /** Direction from the subject to the photographer */
  photographerSideDeg: number;
  /** Direction the photographer's camera points */
  cameraFacesDeg: number;
  /** Direction the subject faces (toward the camera) */
  subjectFacesDeg: number;
  sentence: string;
};

const norm = (d: number) => ((d % 360) + 360) % 360;

export function orientation(strategy: Strategy, sunAzimuthDeg: number): Orientation {
  const side = norm(sunAzimuthDeg + CAMERA_OFFSET[strategy]);
  const o = { photographerSideDeg: side, cameraFacesDeg: norm(side + 180), subjectFacesDeg: side };
  const sun = compassLabel(sunAzimuthDeg);
  const faces = compassLabel(o.subjectFacesDeg);
  const shoots = compassLabel(o.cameraFacesDeg);
  const sentence = {
    backlight: `Sun behind the subject (sun in the ${sun}). Subject faces ${faces}; you stand on their ${faces} side and shoot toward the ${shoots}, into the light.`,
    side_light: `Sun to the subject's side (sun in the ${sun}). Subject faces ${faces}; you stand on their ${faces} side and shoot toward the ${shoots}, so light falls across one side of the face.`,
    front_light: `Sun behind you (sun in the ${sun}). Subject faces ${faces}, toward the sun; you stand between them and the sun and shoot toward the ${shoots}. Watch for squinting.`,
    open_shade: `Subject just inside a shade line (a tree canopy, building, or wall), facing out toward open sky. The sun is in the ${sun}; keep direct sun off faces.`,
    overcast_soft: `Cloud cover makes the light soft from every direction. The sun is roughly in the ${sun}; face the subject toward the brightest part of the sky.`,
  }[strategy];
  return { ...o, sentence };
}

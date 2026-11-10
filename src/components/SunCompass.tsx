import type { ShotPlan } from "@/lib/schema";

/**
 * Top-down placement diagram. The subject is at the center; the sun sits on the rim at its
 * real azimuth; the camera is placed by the light strategy:
 *   backlight  → camera opposite the sun (subject between camera and sun)
 *   side_light → camera 90° from the sun
 *   front_light→ camera on the sun's side, so light falls on faces
 *   open_shade / overcast_soft → direction matters less: the sun is drawn faded, the camera faces the open sky
 * Pure geometry from the plan: no extra facts are invented.
 */
type Strategy = ShotPlan["lighting"]["strategy"];

const CAMERA_OFFSET: Record<Strategy, number> = {
  backlight: 180,
  side_light: 90,
  front_light: 0,
  open_shade: 180,
  overcast_soft: 180,
};

const SIZE = 240;
const C = SIZE / 2;
const R = 96;

function point(azimuthDeg: number, radius: number) {
  const rad = ((azimuthDeg - 90) * Math.PI) / 180; // 0° = north = up
  return { x: C + radius * Math.cos(rad), y: C + radius * Math.sin(rad) };
}

export function SunCompass({ azimuthDeg, compass, strategy }: { azimuthDeg: number; compass: string; strategy: Strategy }) {
  const diffuse = strategy === "open_shade" || strategy === "overcast_soft";
  const sun = point(azimuthDeg, R);
  const camAz = (azimuthDeg + CAMERA_OFFSET[strategy]) % 360;
  const cam = point(camAz, R * 0.62);
  const camAngle = camAz + 180; // camera faces the subject at the center
  const rays = Array.from({ length: 8 }, (_, i) => i * 45);

  return (
    <figure className="flex flex-col items-center">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-[260px]" role="img"
        aria-label={`Sun in the ${compass} at ${Math.round(azimuthDeg)} degrees. Camera ${diffuse ? "faces the open sky" : "positioned for " + strategy.replace("_", " ")}.`}>
        {/* ground ring and ticks */}
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--color-dusk-3)" strokeWidth="1.5" />
        <circle cx={C} cy={C} r={R * 0.62} fill="none" stroke="var(--color-dusk-3)" strokeDasharray="2 5" />
        {Array.from({ length: 36 }, (_, i) => {
          const a = point(i * 10, R);
          const b = point(i * 10, R - (i % 9 === 0 ? 10 : 4));
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-dusk-3)" strokeWidth={i % 9 === 0 ? 2 : 1} />;
        })}
        {(["N", "E", "S", "W"] as const).map((l, i) => {
          const p = point(i * 90, R + 13);
          return (
            <text key={l} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize="11" fill="var(--color-haze)" fontWeight={l === "N" ? 700 : 400}>
              {l}
            </text>
          );
        })}

        {/* light falling from the sun across the subject */}
        {!diffuse && (
          <line x1={sun.x} y1={sun.y} x2={C} y2={C} stroke="var(--color-gold)" strokeWidth="10" strokeLinecap="round" opacity="0.13" />
        )}

        {/* sun */}
        <g opacity={diffuse ? 0.35 : 1}>
          {rays.map((a) => {
            const r1 = { x: sun.x + 13 * Math.cos((a * Math.PI) / 180), y: sun.y + 13 * Math.sin((a * Math.PI) / 180) };
            const r2 = { x: sun.x + 18 * Math.cos((a * Math.PI) / 180), y: sun.y + 18 * Math.sin((a * Math.PI) / 180) };
            return <line key={a} x1={r1.x} y1={r1.y} x2={r2.x} y2={r2.y} stroke="var(--color-gold)" strokeWidth="2" strokeLinecap="round" />;
          })}
          <circle cx={sun.x} cy={sun.y} r="9" fill="var(--color-gold)" />
        </g>

        {/* camera: a small body with a lens, pointed at the subject */}
        <g transform={`translate(${cam.x} ${cam.y}) rotate(${camAngle})`}>
          <rect x="-9" y="-6" width="18" height="12" rx="3" fill="var(--color-paper)" />
          <rect x="-4" y="-11" width="8" height="6" rx="1.5" fill="var(--color-paper)" />
          <circle cx="0" cy="0" r="3.2" fill="var(--color-dusk)" />
        </g>

        {/* subject */}
        <circle cx={C} cy={C} r="11" fill="var(--color-dusk)" stroke="var(--color-paper)" strokeWidth="2" />
        <circle cx={C} cy={C - 2.5} r="3" fill="var(--color-paper)" />
        <path d={`M ${C - 5} ${C + 6} q 5 -6 10 0`} fill="var(--color-paper)" />
      </svg>
      <figcaption className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-haze">
        <span><span className="mr-1.5 inline-block size-2 rounded-full bg-gold align-middle" />Sun {Math.round(azimuthDeg)}° {compass}</span>
        <span><span className="mr-1.5 inline-block size-2 rounded-full border border-paper align-middle" />Subject</span>
        <span><span className="mr-1.5 inline-block h-2 w-2.5 rounded-[2px] bg-paper align-middle" />You</span>
      </figcaption>
    </figure>
  );
}

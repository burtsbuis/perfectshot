import { z } from "zod";

/** "HH:mm" in the location's local time */
const LocalTime = z.string().regex(/^\d{2}:\d{2}$/);
/** ISO 8601 timestamp with offset */
const IsoTime = z.string();

// ---------- Request (user input) ----------
export const PlanRequestSchema = z.object({
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    name: z.string().optional(),
  }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeWindow: z.object({ start: LocalTime, end: LocalTime }).optional(),
  gear: z.object({ bodyId: z.string(), lensId: z.string() }),
  subjects: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  vibe: z.enum(["natural", "moody", "bright_airy", "editorial"]).optional(),
  notes: z.string().max(500).optional(),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

// ---------- Facts (computed by code; never by the LLM) ----------
const Window = z.object({ start: IsoTime, end: IsoTime });

export const SunFactsSchema = z.object({
  sunrise: IsoTime.nullable(),
  sunset: IsoTime.nullable(),
  goldenHourMorning: Window.nullable(),
  goldenHourEvening: Window.nullable(),
  blueHourMorning: Window.nullable(),
  blueHourEvening: Window.nullable(),
  positions: z.array(
    z.object({ time: IsoTime, azimuthDeg: z.number(), altitudeDeg: z.number() }),
  ),
});
export type SunFacts = z.infer<typeof SunFactsSchema>;

export const WeatherFactsSchema = z.object({
  hourly: z.array(
    z.object({
      time: IsoTime,
      cloudCoverPct: z.number(),
      precipProbPct: z.number(),
      tempC: z.number(),
      windKph: z.number(),
    }),
  ),
});
export type WeatherFacts = z.infer<typeof WeatherFactsSchema>;

export const BodySchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string(),
  sensor: z.enum(["APS-C", "FF", "MFT"]),
  mount: z.string(),
  maxUsableIso: z.number(),
  ibis: z.boolean(),
  eyeAf: z.boolean(),
});
export type Body = z.infer<typeof BodySchema>;

export const LensSchema = z.object({
  id: z.string(),
  name: z.string(),
  mounts: z.array(z.string()),
  focalMm: z.union([z.number(), z.tuple([z.number(), z.number()])]),
  /** Widest aperture; for variable-aperture zooms this is [wide end, tele end] */
  maxAperture: z.union([z.number(), z.tuple([z.number(), z.number()])]),
  stabilized: z.boolean(),
});
export type Lens = z.infer<typeof LensSchema>;

export const ShootFactsSchema = z.object({
  sun: SunFactsSchema,
  weather: WeatherFactsSchema.nullable(),
  gear: z.object({ body: BodySchema, lens: LensSchema }),
  timezone: z.string(),
});
export type ShootFacts = z.infer<typeof ShootFactsSchema>;

// ---------- Shot Plan (agent output) ----------
export const LightStrategy = z.enum([
  "backlight",
  "side_light",
  "front_light",
  "open_shade",
  "overcast_soft",
]);

export const ShotPlanSchema = z.object({
  summary: z.string(),
  recommendedWindows: z
    .array(
      z.object({
        start: IsoTime,
        end: IsoTime,
        label: z.string(),
        why: z.string(),
        rank: z.number().int().min(1),
      }),
    )
    .min(1),
  lighting: z.object({
    sunDirectionAtBestTime: z.object({ azimuthDeg: z.number(), compass: z.string() }),
    strategy: LightStrategy,
    subjectPlacement: z.string(),
    photographerPlacement: z.string(),
    tips: z.array(z.string()),
  }),
  settings: z.object({
    mode: z.enum(["aperture_priority", "manual"]),
    aperture: z.number(),
    shutterSpeed: z.string(),
    iso: z.union([z.number(), z.literal("auto")]),
    exposureCompensation: z.number().optional(),
    focusMode: z.string(),
    whiteBalance: z.string(),
    why: z.string(),
  }),
  poses: z
    .array(
      z.object({
        name: z.string(),
        instructions: z.array(z.string()),
        bestFor: z.string(),
      }),
    )
    .min(3)
    .max(5),
  weatherCaveat: z.string(),
  backupPlan: z.string(),
  checklist: z.array(z.string()),
});
export type ShotPlan = z.infer<typeof ShotPlanSchema>;

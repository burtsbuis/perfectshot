import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { equivalentFocal, getBody, getLens, maxApertureAt } from "../gear";
import { findPoses } from "../poses";
import { LightStrategy, ShotPlanSchema } from "../schema";
import { compassLabel, getSunFacts } from "../sun";
import { timezoneAt } from "../timezone";
import { getWeather, type Fetch } from "../weather";

/**
 * Tool layer for the agent. Each tool = JSON schema for Claude + a Zod-validated executor.
 * Executors return compact, LLM-friendly JSON: local times next to ISO times and only
 * the fields the model needs, which keeps token usage down.
 */

export type ToolContext = { fetch?: Fetch; now?: Date };

const LatLngDate = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// Memoize weather per location/date: get_sun_data needs the timezone, get_weather needs the forecast
const weatherCache = new Map<string, ReturnType<typeof getWeather>>();
function weatherFor(a: z.infer<typeof LatLngDate>, ctx: ToolContext) {
  const key = `${a.lat},${a.lng},${a.date}`;
  if (!weatherCache.has(key)) {
    const p = getWeather(a.lat, a.lng, a.date, ctx);
    p.catch(() => weatherCache.delete(key)); // don't cache failures
    weatherCache.set(key, p);
  }
  return weatherCache.get(key)!;
}
async function timezoneFor(a: z.infer<typeof LatLngDate>) {
  return timezoneAt(a.lat, a.lng); // offline; never depends on the weather service
}

const localTime = (iso: string | null | undefined, tz: string) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }) : null;
const localWindow = (w: { start: string; end: string } | null, tz: string) =>
  w ? { ...w, local: `${localTime(w.start, tz)}–${localTime(w.end, tz)}` } : null;

type ToolDef = {
  spec: Anthropic.Messages.Tool;
  run: (input: unknown, ctx: ToolContext) => Promise<unknown>;
};

const latLngDateSchema = {
  type: "object" as const,
  properties: {
    lat: { type: "number" },
    lng: { type: "number" },
    date: { type: "string", description: "YYYY-MM-DD" },
  },
  required: ["lat", "lng", "date"],
};

export const TOOLS: Record<string, ToolDef> = {
  get_sun_data: {
    spec: {
      name: "get_sun_data",
      description:
        "Sunrise/sunset, golden and blue hour windows, and the sun's azimuth (compass degrees, 0=N, 90=E) and altitude every 30 minutes, for a location and date. Times are ISO UTC with a `local` label in the location's timezone. Always call this before choosing times or sun direction.",
      input_schema: latLngDateSchema,
    },
    async run(input) {
      const a = LatLngDate.parse(input);
      const tz = await timezoneFor(a);
      const s = getSunFacts(a.lat, a.lng, a.date, 30);
      return {
        timezone: tz,
        sunrise: { iso: s.sunrise, local: localTime(s.sunrise, tz) },
        sunset: { iso: s.sunset, local: localTime(s.sunset, tz) },
        goldenHourMorning: localWindow(s.goldenHourMorning, tz),
        goldenHourEvening: localWindow(s.goldenHourEvening, tz),
        blueHourMorning: localWindow(s.blueHourMorning, tz),
        blueHourEvening: localWindow(s.blueHourEvening, tz),
        positions: s.positions.map((p) => ({
          iso: p.time,
          local: localTime(p.time, tz),
          azimuthDeg: p.azimuthDeg,
          compass: compassLabel(p.azimuthDeg),
          altitudeDeg: p.altitudeDeg,
        })),
      };
    },
  },

  get_weather: {
    spec: {
      name: "get_weather",
      description:
        "Hourly cloud cover %, precipitation probability %, temperature °C and wind km/h for the date. Returns `forecast: null` if the date is more than ~16 days out; in that case give a general seasonal caveat and do NOT invent numbers.",
      input_schema: latLngDateSchema,
    },
    async run(input, ctx) {
      const a = LatLngDate.parse(input);
      const { timezone, weather } = await weatherFor(a, ctx);
      if (!weather) return { timezone, forecast: null, reason: "Date outside the forecast range" };
      return {
        timezone,
        forecast: weather.hourly
          .filter((_, i) => i >= 5 && i <= 21) // 5am–9pm local covers every portrait window
          .map((h) => ({ ...h, local: localTime(h.time, timezone) })),
      };
    },
  },

  get_gear_specs: {
    spec: {
      name: "get_gear_specs",
      description:
        "Specs for the user's camera body and lens: sensor, usable ISO ceiling, stabilization, eye AF, focal range, and the widest aperture available (per focal length for zooms). Settings you recommend MUST respect these limits.",
      input_schema: {
        type: "object",
        properties: { bodyId: { type: "string" }, lensId: { type: "string" } },
        required: ["bodyId", "lensId"],
      },
    },
    async run(input) {
      const { bodyId, lensId } = z.object({ bodyId: z.string(), lensId: z.string() }).parse(input);
      const body = getBody(bodyId);
      const lens = getLens(lensId);
      if (!body || !lens) throw new Error(`Unknown gear id: ${!body ? bodyId : lensId}`);
      const focals = Array.isArray(lens.focalMm)
        ? [lens.focalMm[0], Math.round((lens.focalMm[0] + lens.focalMm[1]) / 2), lens.focalMm[1]]
        : [lens.focalMm];
      return {
        body,
        lens,
        widestApertureByFocal: focals.map((f) => ({
          focalMm: f,
          fullFrameEquivalentMm: equivalentFocal(f, body),
          widestAperture: maxApertureAt(lens, f),
        })),
      };
    },
  },

  get_pose_library: {
    spec: {
      name: "get_pose_library",
      description:
        "Curated poses that suit the subject count, ranked by fit with the light strategy and vibe. Prefer these (and pass their id as libraryId); you may adapt the cues to the location.",
      input_schema: {
        type: "object",
        properties: {
          subjects: { type: "integer", minimum: 1, maximum: 4, description: "4 means a group of 4+" },
          light: { type: "string", enum: LightStrategy.options },
          vibe: { type: "string", enum: ["natural", "moody", "bright_airy", "editorial"] },
        },
        required: ["subjects"],
      },
    },
    async run(input) {
      const a = z
        .object({
          subjects: z.number().int(),
          light: LightStrategy.optional(),
          vibe: z.enum(["natural", "moody", "bright_airy", "editorial"]).optional(),
        })
        .parse(input);
      return { poses: findPoses({ ...a, limit: 8 }) };
    },
  },
};

/** The terminal tool: the agent finishes by submitting a plan that matches ShotPlanSchema. */
export const SUBMIT_PLAN = "submit_plan";
export const submitPlanTool: Anthropic.Messages.Tool = {
  name: SUBMIT_PLAN,
  description:
    "Submit the final Shot Plan. Call exactly once, after gathering facts. All times are ISO 8601 UTC taken from tool results. For zoom lenses include settings.focalLengthMm.",
  input_schema: (() => {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(ShotPlanSchema) as Record<string, unknown>;
    void _ignored;
    return schema as Anthropic.Messages.Tool.InputSchema;
  })(),
};

export const ALL_TOOL_SPECS: Anthropic.Messages.Tool[] = [...Object.values(TOOLS).map((t) => t.spec), submitPlanTool];

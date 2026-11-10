import type { WeatherFacts } from "./schema";

/**
 * Open-Meteo client (free, no API key).
 * The forecast covers roughly 16 days ahead. For dates outside that range we return
 * `weather: null` and the agent gives a generic weather caveat instead of inventing a forecast.
 */
const BASE = "https://api.open-meteo.com/v1/forecast";
export const FORECAST_DAYS = 16;

export type Fetch = typeof fetch;

type OpenMeteoResponse = {
  timezone: string;
  utc_offset_seconds: number;
  hourly?: {
    time: string[]; // local "YYYY-MM-DDTHH:mm"
    cloud_cover: number[];
    precipitation_probability: (number | null)[];
    temperature_2m: number[];
    wind_speed_10m: number[];
  };
};

/** Convert an Open-Meteo local time string plus UTC offset to an ISO UTC string. */
export function localToIso(local: string, utcOffsetSeconds: number): string {
  return new Date(Date.parse(`${local}:00Z`) - utcOffsetSeconds * 1000).toISOString();
}

/** Whole days from today (UTC) to `date` ("YYYY-MM-DD"). */
export function daysFromToday(date: string, now = new Date()): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(`${date}T00:00:00Z`) - today) / 86_400_000);
}

export function isForecastable(date: string, now = new Date()): boolean {
  const d = daysFromToday(date, now);
  return d >= 0 && d < FORECAST_DAYS;
}

export async function getWeather(
  lat: number,
  lng: number,
  date: string,
  opts: { fetch?: Fetch; now?: Date } = {},
): Promise<{ timezone: string; weather: WeatherFacts | null }> {
  const f = opts.fetch ?? fetch;
  const forecastable = isForecastable(date, opts.now);
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    timezone: "auto",
  });
  if (forecastable) {
    params.set("hourly", "cloud_cover,precipitation_probability,temperature_2m,wind_speed_10m");
    params.set("start_date", date);
    params.set("end_date", date);
  } else {
    // Still call the API so we learn the location's timezone
    params.set("forecast_days", "1");
  }

  const res = await f(`${BASE}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as OpenMeteoResponse;

  if (!forecastable || !data.hourly) return { timezone: data.timezone, weather: null };

  const h = data.hourly;
  return {
    timezone: data.timezone,
    weather: {
      hourly: h.time.map((t, i) => ({
        time: localToIso(t, data.utc_offset_seconds),
        cloudCoverPct: h.cloud_cover[i],
        precipProbPct: h.precipitation_probability[i] ?? 0,
        tempC: h.temperature_2m[i],
        windKph: h.wind_speed_10m[i],
      })),
    },
  };
}

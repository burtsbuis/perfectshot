import { getBody, getLens } from "./gear";
import type { PlanRequest, ShootFacts } from "./schema";
import { getSunFacts } from "./sun";
import { getWeather, type Fetch } from "./weather";

/**
 * Assemble every computable fact for a request. Stage 1 lets the agent fetch these through tools;
 * the checks (and later stages) use this to get the same facts directly.
 */
export async function buildFacts(req: PlanRequest, opts: { fetch?: Fetch; now?: Date } = {}): Promise<ShootFacts> {
  const body = getBody(req.gear.bodyId);
  const lens = getLens(req.gear.lensId);
  if (!body) throw new Error(`Unknown body: ${req.gear.bodyId}`);
  if (!lens) throw new Error(`Unknown lens: ${req.gear.lensId}`);
  if (!lens.mounts.includes(body.mount)) throw new Error(`${lens.name} doesn't fit ${body.name}`);

  const sun = getSunFacts(req.location.lat, req.location.lng, req.date);
  let timezone = "UTC";
  let weather: ShootFacts["weather"] = null;
  try {
    ({ timezone, weather } = await getWeather(req.location.lat, req.location.lng, req.date, opts));
  } catch (err) {
    console.warn("Weather lookup failed; continuing without a forecast", err);
  }
  return { sun, weather, gear: { body, lens }, timezone };
}

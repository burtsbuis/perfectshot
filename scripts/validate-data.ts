import { z } from "zod";
import gear from "../data/gear.json";
import poses from "../data/poses.json";
import evals from "../evals/scenarios.json";
import { BodySchema, LensSchema, PlanRequestSchema } from "../src/lib/schema";
import { getSunFacts } from "../src/lib/sun";

const bodies = z.array(BodySchema).parse(gear.bodies);
const lenses = z.array(LensSchema).parse(gear.lenses);
const ids = new Set<string>();
for (const g of [...bodies, ...lenses]) {
  if (ids.has(g.id)) throw new Error(`Duplicate gear id ${g.id}`);
  ids.add(g.id);
}

const PoseSchema = z.object({
  id: z.string(), name: z.string(),
  subjects: z.array(z.number().int().min(1).max(4)).min(1),
  vibes: z.array(z.enum(["natural", "moody", "bright_airy", "editorial"])).min(1),
  light: z.array(z.enum(["backlight", "side_light", "front_light", "open_shade", "overcast_soft"])).min(1),
  instructions: z.array(z.string()).min(2), bestFor: z.string(),
});
const p = z.array(PoseSchema).parse(poses.poses);
for (const n of [1, 2, 3, 4]) {
  const c = p.filter((x) => x.subjects.includes(n)).length;
  if (c < 5) throw new Error(`Only ${c} poses for ${n} subjects`);
}

for (const s of evals.scenarios) {
  const r = PlanRequestSchema.parse(s.request);
  const body = bodies.find((b) => b.id === r.gear.bodyId);
  const lens = lenses.find((l) => l.id === r.gear.lensId);
  if (!body || !lens) throw new Error(`Scenario ${s.id}: unknown gear`);
  if (!lens.mounts.includes(body.mount)) throw new Error(`Scenario ${s.id}: ${lens.name} doesn't fit ${body.name}`);
  const sun = getSunFacts(r.location.lat, r.location.lng, r.date);
  const fmt = (x: string | null) => x ? new Date(x).toLocaleTimeString("en-US", { timeZone: s.timezone, hour: "numeric", minute: "2-digit" }) : "none";
  console.log(`#${s.id} ${s.name.padEnd(32)} sunrise ${fmt(sun.sunrise).padStart(8)}  sunset ${fmt(sun.sunset).padStart(8)}`);
}
console.log(`\n✓ ${bodies.length} bodies, ${lenses.length} lenses, ${p.length} poses, ${evals.scenarios.length} scenarios valid`);

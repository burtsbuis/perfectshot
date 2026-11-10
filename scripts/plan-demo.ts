/**
 * Run the Stage 1 agent on an eval scenario from the terminal.
 *   npm run plan:demo -- 1        (scenario id; needs ANTHROPIC_API_KEY in .env.local)
 * Prints the agent trace, the plan, and the rule-check results.
 */
import Anthropic from "@anthropic-ai/sdk";
import evals from "../evals/scenarios.json";
import { runStage1 } from "../src/lib/agent/stage1";
import { runChecks } from "../src/lib/checks";
import { buildFacts } from "../src/lib/facts";
import { PlanRequestSchema } from "../src/lib/schema";

const id = Number(process.argv[2] ?? 1);
const scenario = evals.scenarios.find((s) => s.id === id);
if (!scenario) throw new Error(`No scenario ${id}`);
const req = PlanRequestSchema.parse(scenario.request);
const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
const client = new Anthropic();

console.log(`\n▶ Scenario #${id}: ${scenario.name} (${scenario.tests})\n  model: ${model}\n`);
const t0 = Date.now();
const facts = await buildFacts(req);
const res = await runStage1(req, { create: (p) => client.messages.create(p), model });

for (const s of res.trace) {
  if (s.type === "model") console.log(`  turn ${s.turn} · model ${s.ms}ms · ${s.inputTokens} in / ${s.outputTokens} out · ${s.stopReason}`);
  else console.log(`    ↳ ${s.name}${s.error ? ` ✗ ${s.error.split("\n")[0]}` : ""} (${s.ms}ms)`);
}

const tz = facts.timezone;
const t = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
const p = res.plan;
console.log(`\n${p.summary}\n`);
for (const w of p.recommendedWindows) console.log(`  #${w.rank} ${w.label}: ${t(w.start)}–${t(w.end)}. ${w.why}`);
console.log(`\n  Light: ${p.lighting.strategy}, sun ${p.lighting.sunDirectionAtBestTime.azimuthDeg}° ${p.lighting.sunDirectionAtBestTime.compass}`);
console.log(`  Subject: ${p.lighting.subjectPlacement}\n  You: ${p.lighting.photographerPlacement}`);
const st = p.settings;
console.log(`  Settings: f/${st.aperture}${st.focalLengthMm ? ` @ ${st.focalLengthMm}mm` : ""}, ${st.shutterSpeed}, ISO ${st.iso}, ${st.focusMode}`);
console.log(`  Poses: ${p.poses.map((x) => x.name).join(" · ")}`);
console.log(`  Weather: ${p.weatherCaveat}\n  Backup: ${p.backupPlan}\n`);

console.log("Checks:");
for (const c of runChecks(p, req, facts)) console.log(`  ${c.status === "pass" ? "✓" : c.status === "skip" ? "–" : "✗"} ${c.id}: ${c.message}`);
console.log(`\n${res.turns} turns · ${res.usage.inputTokens} in / ${res.usage.outputTokens} out tokens · ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

import type Anthropic from "@anthropic-ai/sdk";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFacts } from "../../facts";
import { bakerReq, fakeOpenMeteo } from "../../__tests__/fixtures";
import type { CreateMessage } from "../stage1";
import { MAX_REVIEW_ROUNDS, runStage3 } from "../stage3";

/**
 * Stage 3 is tested with a fake model that plays every node AND the critic. The critic's verdicts
 * are scripted per round, so we can check exactly which steps get re-run.
 */
type Params = Anthropic.Messages.MessageCreateParamsNonStreaming;
const NOW = new Date("2026-11-10T12:00:00Z");

const reply = (name: string, input: unknown) =>
  ({ content: [{ type: "tool_use", id: `${name}-${Math.random()}`, name, input }], stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 50 } }) as unknown as Anthropic.Messages.Message;
const enumAt = (p: Params, path: string[]) => {
  let s = (p.tools![0] as Anthropic.Messages.Tool).input_schema as Record<string, unknown>;
  for (const k of path) s = (s as Record<string, Record<string, unknown>>)[k] as Record<string, unknown>;
  return (s as { enum: string[] }).enum;
};
const lastUserText = (p: Params) => {
  const c = p.messages.at(-1)!.content;
  return typeof c === "string" ? c : JSON.stringify(c);
};

type Review = { verdict: "approve" | "revise"; issues: { node: string; severity: "major" | "minor"; problem: string; fix: string }[] };

function fakeModel(reviews: Review[]) {
  const calls: { tool: string; params: Params }[] = [];
  let round = 0;
  const create: CreateMessage = async (params) => {
    const tool = (params.tools![0] as Anthropic.Messages.Tool).name;
    calls.push({ tool, params: structuredClone(params) });
    switch (tool) {
      case "submit_light":
        return reply(tool, {
          windows: [{ id: "golden_evening", why: "Warm low sun" }, { id: "blue_evening", why: "Soft after sunset" }],
          strategy: "backlight",
          siteNotes: "Sand below the bluffs, ocean behind them.",
          tips: [],
          weatherCaveat: "Fog possible.",
          backupPlan: "Cypress trees.",
        });
      case "submit_settings":
        return reply(tool, { mode: "aperture_priority", aperture: 2.2, shutterSpeed: "1/250", iso: "auto", exposureCompensation: 0.7, focusMode: "AF-C with eye AF", whiteBalance: "Cloudy", why: "Blur." });
      case "submit_poses":
        return reply(tool, { poses: enumAt(params, ["properties", "poses", "items", "properties", "libraryId"]).slice(0, 3).map((libraryId) => ({ libraryId })) });
      case "submit_text":
        return reply(tool, {
          summary: "Shoot at golden hour with the sun behind the couple.",
          windowWhy: [{ id: "golden_evening", why: "Warm." }, { id: "blue_evening", why: "Soft." }],
          subjectPlacement: "Couple on the sand below the bluffs.",
          photographerPlacement: "Stand by the bluffs facing the ocean.",
          tips: [],
          settingsWhy: "Blurs the background.",
          weatherCaveat: "Fog possible.",
          backupPlan: "Move to the cypress trees.",
          checklist: ["Batteries", "Lens cloth", "Jacket"],
        });
      case "submit_review":
        return reply(tool, reviews[Math.min(round++, reviews.length - 1)]);
    }
    throw new Error(`unexpected tool ${tool}`);
  };
  return { create, calls, count: (tool: string) => calls.filter((c) => c.tool === tool).length };
}

const approve: Review = { verdict: "approve", issues: [] };
const posesIssue: Review = {
  verdict: "revise",
  issues: [
    { node: "poses", severity: "major", problem: "Over-the-shoulder pose faces them into the sun, against the backlight plan.", fix: "Swap it for a pose facing away from the sun." },
    { node: "writer", severity: "minor", problem: "Summary is a bit long.", fix: "Trim." },
  ],
};
const lightIssue: Review = {
  verdict: "revise",
  issues: [{ node: "light", severity: "major", problem: "The bluffs block a 2° sun at this spot.", fix: "Move to the open beach or choose an earlier window." }],
};

async function run(reviews: Review[]) {
  const facts = await buildFacts(bakerReq, { fetch: fakeOpenMeteo(), now: NOW });
  const m = fakeModel(reviews);
  const res = await runStage3(bakerReq, { create: m.create, model: "fake", facts });
  const steps = res.trace.flatMap((s) => (s.type === "node" && s.kind === "model" ? [s.name] : []));
  return { res, m, steps };
}

describe("stage 3 critic loop", () => {
  it("ships the draft when the critic approves", async () => {
    const { res, m, steps } = await run([approve]);
    assert.equal(m.count("submit_review"), 1);
    assert.deepEqual(steps.filter((s) => s.includes("revision")), []);
    assert.equal(res.critiques?.length, 1);
    assert.equal(res.critiques?.[0].verdict, "approve");
  });

  it("re-runs only the flagged step (and the writer), then re-reviews", async () => {
    const { res, m, steps } = await run([posesIssue, approve]);
    assert.ok(steps.includes("poses (revision 1)"));
    assert.ok(steps.includes("writer (revision 1)"));
    assert.ok(!steps.includes("light (revision 1)"));
    assert.ok(!steps.includes("settings (revision 1)"));
    assert.equal(m.count("submit_review"), 2);
    // the poses node got the critic's problem and fix, plus its previous answer
    const revisedPoses = m.calls.filter((c) => c.tool === "submit_poses")[1];
    assert.match(lastUserText(revisedPoses.params), /REVISION REQUESTED[\s\S]*faces them into the sun[\s\S]*Swap it for a pose[\s\S]*Your previous answer/);
    // minor issues are recorded but don't trigger work
    assert.equal(res.critiques?.[0].issues.length, 2);
    assert.equal(res.critiques?.[1].verdict, "approve");
  });

  it("re-runs everything downstream when the light decision is flagged", async () => {
    const { steps } = await run([lightIssue, approve]);
    for (const n of ["light", "settings", "poses", "writer"]) assert.ok(steps.includes(`${n} (revision 1)`), n);
  });

  it(`stops after ${MAX_REVIEW_ROUNDS} rounds even if the critic keeps objecting`, async () => {
    const { res, m } = await run([posesIssue, posesIssue, posesIssue]);
    assert.equal(m.count("submit_review"), MAX_REVIEW_ROUNDS);
    assert.equal(res.critiques?.length, MAX_REVIEW_ROUNDS);
    assert.ok(res.critiques?.every((c) => c.verdict === "revise"));
  });

  it("rejects a 'revise' verdict with no major issues (the critic must approve instead)", async () => {
    const onlyMinor: Review = { verdict: "revise", issues: [{ node: "writer", severity: "minor", problem: "Long.", fix: "Trim." }] };
    const { m } = await run([onlyMinor, approve, approve]);
    // first critic answer is rejected by the schema and retried (the fake then approves)
    assert.equal(m.count("submit_review"), 2);
  });
});

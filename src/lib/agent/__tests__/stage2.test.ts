import type Anthropic from "@anthropic-ai/sdk";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allPassed, runChecks } from "../../checks";
import { buildFacts } from "../../facts";
import { bakerReq, fakeOpenMeteo } from "../../__tests__/fixtures";
import { AgentError, type CreateMessage } from "../stage1";
import { runStage2 } from "../stage2/graph";

/**
 * The graph is tested with a fake model that answers by node (it looks at which submit tool
 * it was offered). It can also delay answers to prove settings and poses run in parallel.
 */
type Params = Anthropic.Messages.MessageCreateParamsNonStreaming;
const NOW = new Date("2026-11-10T12:00:00Z");

function reply(name: string, input: unknown): Anthropic.Messages.Message {
  return {
    content: [{ type: "tool_use", id: `${name}-${Math.random()}`, name, input }],
    stop_reason: "tool_use",
    usage: { input_tokens: 100, output_tokens: 50 },
  } as unknown as Anthropic.Messages.Message;
}
const enumOf = (p: Params, path: string[]) => {
  let s = (p.tools![0] as Anthropic.Messages.Tool).input_schema as Record<string, unknown>;
  for (const k of path) s = (s as Record<string, Record<string, unknown>>)[k] as Record<string, unknown>;
  return (s as { enum: string[] }).enum;
};

const writerText = {
  summary: "Shoot at evening golden hour with the sun behind the couple over the ocean.",
  windowWhy: [{ id: "golden_evening", why: "Warm low sun for a soft glow." }],
  subjectPlacement: "Couple on firm sand above the waterline, facing the dunes.",
  photographerPlacement: "Stand between them and the dunes, shooting toward the ocean.",
  tips: ["Tap their faces to set exposure."],
  settingsWhy: "Wide aperture blurs the background; Auto ISO keeps faces bright.",
  weatherCaveat: "Fog can roll in; check the sky an hour before.",
  backupPlan: "If foggy, shoot close-ups by the cypress trees.",
  checklist: ["Charge batteries", "Pack a lens cloth", "Check the tide"],
};

function script(opts: { badApertureFirst?: boolean; delayMs?: number } = {}) {
  const calls: { node: string; at: number; params: Params }[] = [];
  let settingsTries = 0;
  const t0 = Date.now();
  const create: CreateMessage = async (params) => {
    const tool = (params.tools![0] as Anthropic.Messages.Tool).name;
    calls.push({ node: tool, at: Date.now() - t0, params: structuredClone(params) });
    if (opts.delayMs && (tool === "submit_settings" || tool === "submit_poses")) await new Promise((r) => setTimeout(r, opts.delayMs));
    switch (tool) {
      case "submit_light":
        return reply(tool, {
          windows: [{ id: "golden_evening", why: "Warm, low sun over the water" }],
          strategy: "backlight",
          siteNotes: "Set up on the sand south of the bluffs with the ocean behind them.",
          tips: ["Use a lens hood"],
          weatherCaveat: "Fog is possible.",
          backupPlan: "Close-ups under the cypress trees.",
        });
      case "submit_settings":
        settingsTries++;
        return reply(tool, {
          mode: "aperture_priority",
          aperture: opts.badApertureFirst && settingsTries === 1 ? 1.4 : 2.2,
          shutterSpeed: "1/250",
          iso: "auto",
          exposureCompensation: 0.7,
          focusMode: "AF-C with eye AF",
          whiteBalance: "Cloudy",
          why: "Blurs the background.",
        });
      case "submit_poses": {
        const ids = enumOf(params, ["properties", "poses", "items", "properties", "libraryId"]);
        return reply(tool, { poses: ids.slice(0, 3).map((libraryId, i) => (i === 0 ? { libraryId, locationCue: "Walk along the waterline" } : { libraryId })) });
      }
      case "submit_text":
        return reply(tool, writerText);
    }
    throw new Error(`unexpected tool ${tool}`);
  };
  return { create, calls };
}

describe("stage 2 graph", () => {
  it("produces a plan whose numbers all come from code and passes every check", async () => {
    const facts = await buildFacts(bakerReq, { fetch: fakeOpenMeteo(), now: NOW });
    const { create } = script();
    const res = await runStage2(bakerReq, { create, model: "fake", facts });
    const p = res.plan;

    assert.equal(p.recommendedWindows[0].start, facts.sun.goldenHourEvening!.start); // exact, not retyped
    assert.equal(p.lighting.sunDirectionAtBestTime.compass, "WSW");
    assert.equal(p.poses.length, 3);
    assert.match(p.poses[0].instructions.at(-1)!, /waterline/); // location cue appended to a library pose
    const checks = runChecks(p, bakerReq, facts);
    assert.ok(allPassed(checks), JSON.stringify(checks.filter((c) => c.status === "fail")));
    assert.equal(res.turns, 4);
    assert.deepEqual(res.usage, { inputTokens: 400, outputTokens: 200 });
    const order = res.trace.map((s) => (s.type === "node" ? s.name : s.type));
    assert.deepEqual(order.slice(0, 2), ["windows + exposure", "light"]);
    assert.deepEqual(new Set(order.slice(2, 4)), new Set(["settings", "poses"])); // finish order varies: parallel
    assert.deepEqual(order.slice(4), ["orientation", "writer", "assemble"]);
  });

  it("only offers the light node windows computed by code", async () => {
    const facts = await buildFacts(bakerReq, { fetch: fakeOpenMeteo(), now: NOW });
    const { create, calls } = script();
    await runStage2(bakerReq, { create, model: "fake", facts });
    const light = calls.find((c) => c.node === "submit_light")!;
    assert.deepEqual(enumOf(light.params, ["properties", "windows", "items", "properties", "id"]), ["blue_morning", "golden_morning", "late_afternoon", "golden_evening", "blue_evening"]);
  });

  it("sends an impossible aperture back to the settings node with the reason", async () => {
    const facts = await buildFacts(bakerReq, { fetch: fakeOpenMeteo(), now: NOW });
    const { create, calls } = script({ badApertureFirst: true });
    const res = await runStage2(bakerReq, { create, model: "fake", facts });
    assert.equal(res.plan.settings.aperture, 2.2);
    const retry = calls.filter((c) => c.node === "submit_settings")[1];
    const fb = (retry.params.messages.at(-1)!.content as Anthropic.Messages.ToolResultBlockParam[])[0];
    assert.match(String(fb.content), /f\/1\.4 is wider than this lens allows \(f\/1\.8\)/);
    const settingsStep = res.trace.find((s) => s.type === "node" && s.name === "settings");
    assert.equal(settingsStep?.type === "node" && settingsStep.attempts, 2);
  });

  it("runs settings and poses in parallel", async () => {
    const facts = await buildFacts(bakerReq, { fetch: fakeOpenMeteo(), now: NOW });
    const { create } = script({ delayMs: 150 });
    const t = Date.now();
    const res = await runStage2(bakerReq, { create, model: "fake", facts });
    const s = res.trace.find((x) => x.type === "node" && x.name === "settings");
    const p = res.trace.find((x) => x.type === "node" && x.name === "poses");
    assert.ok(s?.type === "node" && p?.type === "node" && Math.abs(s.startedAtMs - p.startedAtMs) < 50);
    assert.ok(Date.now() - t < 280, "two 150ms nodes in sequence would take 300ms+");
  });

  it("wraps node failures with the trace so far", async () => {
    const facts = await buildFacts(bakerReq, { fetch: fakeOpenMeteo(), now: NOW });
    const create: CreateMessage = async () => {
      throw new Error("boom");
    };
    await assert.rejects(runStage2(bakerReq, { create, model: "fake", facts }), (e: unknown) => e instanceof AgentError && e.trace.some((s) => s.type === "node" && s.name === "light" && !!s.error));
  });
});

import type Anthropic from "@anthropic-ai/sdk";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bakerReq, fakeOpenMeteo, goodBakerPlan } from "../../__tests__/fixtures";
import { AgentError, runStage1, type CreateMessage } from "../stage1";

/**
 * The agent loop is tested against a *scripted* fake model: each call returns the next
 * canned response. This tests the loop's mechanics (parallel tools, error feedback,
 * schema retries, termination) deterministically, with no API key or cost.
 */
type Block = Anthropic.Messages.ContentBlock;
const toolUse = (id: string, name: string, input: unknown): Block =>
  ({ type: "tool_use", id, name, input, caller: { type: "direct" } }) as unknown as Block;
const msg = (content: Block[]): Anthropic.Messages.Message =>
  ({
    id: "msg",
    type: "message",
    role: "assistant",
    model: "fake",
    content,
    stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  }) as unknown as Anthropic.Messages.Message;

function scripted(responses: Anthropic.Messages.Message[]) {
  const calls: Anthropic.Messages.MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (params) => {
    calls.push(structuredClone(params));
    const next = responses.shift();
    if (!next) throw new Error("Script exhausted");
    return next;
  };
  return { create, calls };
}

const loc = { lat: bakerReq.location.lat, lng: bakerReq.location.lng, date: bakerReq.date };
const opts = { model: "fake", fetch: fakeOpenMeteo(), now: new Date("2026-11-10T12:00:00Z") };

describe("stage 1 agent loop", () => {
  it("gathers facts in parallel, recovers from an invalid plan, then returns a valid one", async () => {
    const { create, calls } = scripted([
      msg([
        toolUse("t1", "get_sun_data", loc),
        toolUse("t2", "get_weather", loc),
        toolUse("t3", "get_gear_specs", bakerReq.gear),
        toolUse("t4", "get_pose_library", { subjects: 2, light: "backlight" }),
      ]),
      msg([toolUse("t5", "submit_plan", { summary: "incomplete" })]),
      msg([toolUse("t6", "submit_plan", goodBakerPlan())]),
    ]);

    const res = await runStage1(bakerReq, { ...opts, create });

    assert.equal(res.turns, 3);
    assert.equal(res.plan.settings.aperture, 2.2);
    assert.deepEqual(res.usage, { inputTokens: 300, outputTokens: 150 });

    // Turn 2's input held all four tool results, matched by id
    const toolResults = calls[1].messages.at(-1)!.content as Anthropic.Messages.ToolResultBlockParam[];
    assert.deepEqual(toolResults.map((r) => r.tool_use_id), ["t1", "t2", "t3", "t4"]);
    const sun = JSON.parse(toolResults[0].content as string);
    assert.equal(sun.timezone, "America/Los_Angeles");
    assert.equal(sun.sunset.local, "4:55 PM");

    // Turn 3's input told the model what was wrong with the plan
    const fb = (calls[2].messages.at(-1)!.content as Anthropic.Messages.ToolResultBlockParam[])[0];
    assert.equal(fb.is_error, true);
    assert.match(String(fb.content), /recommendedWindows/);

    assert.ok(res.trace.some((s) => s.type === "tool" && s.name === "submit_plan" && s.error));
  });

  it("feeds tool errors back to the model instead of crashing", async () => {
    const { create, calls } = scripted([
      msg([toolUse("t1", "get_gear_specs", { bodyId: "nope", lensId: "nope" })]),
      msg([toolUse("t2", "submit_plan", goodBakerPlan())]),
    ]);
    const res = await runStage1(bakerReq, { ...opts, create });
    assert.equal(res.turns, 2);
    const r = (calls[1].messages.at(-1)!.content as Anthropic.Messages.ToolResultBlockParam[])[0];
    assert.equal(r.is_error, true);
  });

  it("gives up after too many invalid plans", async () => {
    const bad = () => msg([toolUse("x", "submit_plan", {})]);
    const { create } = scripted([bad(), bad(), bad(), bad()]);
    await assert.rejects(runStage1(bakerReq, { ...opts, create, maxSchemaRetries: 2 }), AgentError);
  });
});

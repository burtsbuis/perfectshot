import type Anthropic from "@anthropic-ai/sdk";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bakerReq, fakeOpenMeteo, goodBakerPlan } from "../../__tests__/fixtures";
import { runChecks } from "../../checks";
import { buildFacts } from "../../facts";
import { averageScore, factsBrief, judgePlan } from "../judge";

const NOW = new Date("2026-11-10T12:00:00Z");

const scores = {
  usefulness: { score: 4, reason: "Actionable" },
  lightReasoning: { score: 5, reason: "Backlight matches the WSW sun" },
  clarity: { score: 3, reason: "A bit long" },
  specificity: { score: 4, reason: "Mentions the beach and the fog" },
  biggestWeakness: "Too wordy",
};

describe("judge", () => {
  it("gives the judge grounded facts and forces structured scores", async () => {
    const facts = await buildFacts(bakerReq, { fetch: fakeOpenMeteo(), now: NOW });
    const plan = goodBakerPlan();
    let sent: Anthropic.Messages.MessageCreateParamsNonStreaming | undefined;
    const res = await judgePlan(
      { request: bakerReq, facts, plan, checks: runChecks(plan, bakerReq, facts), focus: "Sunset backlight" },
      {
        model: "fake",
        create: async (p) => {
          sent = p;
          return {
            content: [{ type: "tool_use", id: "j1", name: "submit_scores", input: scores }],
            usage: { input_tokens: 900, output_tokens: 120 },
          } as unknown as Anthropic.Messages.Message;
        },
      },
    );
    assert.equal(averageScore(res.scores), 4);
    assert.equal(sent?.tool_choice, undefined); // forcing a tool isn't supported by every model
    assert.ok(sent?.tools?.some((t) => "name" in t && t.name === "submit_scores"));
    const prompt = String(sent?.messages[0].content);
    assert.match(prompt, /Sunset backlight/);
    assert.match(prompt, /PASS aperture/);
    assert.match(prompt, /WSW/); // sun direction at evening golden hour is in the facts
  });

  it("summarizes facts in local time", async () => {
    const facts = await buildFacts(bakerReq, { fetch: fakeOpenMeteo(), now: NOW });
    const b = factsBrief(facts);
    assert.equal(b.sunset, "4:55 PM");
    assert.match(b.goldenHourEvening, /^4:1\d PM–4:55 PM \(sun 2\d\d° W?SW/);
  });

  it("nudges the judge once if it answers in prose", async () => {
    const facts = await buildFacts(bakerReq, { fetch: fakeOpenMeteo(), now: NOW });
    const replies = [
      { content: [{ type: "text", text: "This plan looks good overall..." }], usage: { input_tokens: 10, output_tokens: 5 } },
      { content: [{ type: "tool_use", id: "j2", name: "submit_scores", input: scores }], usage: { input_tokens: 20, output_tokens: 5 } },
    ];
    let calls = 0;
    const res = await judgePlan(
      { request: bakerReq, facts, plan: goodBakerPlan(), checks: [] },
      { model: "fake", create: async () => replies[calls++] as unknown as Anthropic.Messages.Message },
    );
    assert.equal(calls, 2);
    assert.equal(res.usage.inputTokens, 30);
    assert.equal(res.scores.lightReasoning.score, 5);
  });

  it("asks the judge to resubmit when its scores come back cut off", async () => {
    const facts = await buildFacts(bakerReq, { fetch: fakeOpenMeteo(), now: NOW });
    const partial = { usefulness: scores.usefulness, lightReasoning: scores.lightReasoning, clarity: scores.clarity };
    const sent: Anthropic.Messages.MessageCreateParamsNonStreaming[] = [];
    const replies = [
      { content: [{ type: "tool_use", id: "j1", name: "submit_scores", input: partial }], stop_reason: "max_tokens", usage: { input_tokens: 10, output_tokens: 5 } },
      { content: [{ type: "tool_use", id: "j2", name: "submit_scores", input: scores }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } },
    ];
    const res = await judgePlan(
      { request: bakerReq, facts, plan: goodBakerPlan(), checks: [] },
      { model: "fake", create: async (p) => { sent.push(structuredClone(p)); return replies[sent.length - 1] as unknown as Anthropic.Messages.Message; } },
    );
    assert.equal(res.scores.biggestWeakness, "Too wordy");
    const feedback = (sent[1].messages.at(-1)!.content as Anthropic.Messages.ToolResultBlockParam[])[0];
    assert.equal(feedback.tool_use_id, "j1");
    assert.equal(feedback.is_error, true);
    assert.match(String(feedback.content), /token limit[\s\S]*specificity/);
  });

  it("rejects scores that stay invalid after retries", async () => {
    const facts = await buildFacts(bakerReq, { fetch: fakeOpenMeteo(), now: NOW });
    const bad = { ...scores, clarity: { score: 9, reason: "?" } };
    await assert.rejects(
      judgePlan(
        { request: bakerReq, facts, plan: goodBakerPlan(), checks: [] },
        {
          model: "fake",
          create: async () =>
            ({ content: [{ type: "tool_use", id: "j", name: "submit_scores", input: bad }], usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as Anthropic.Messages.Message,
        },
      ),
    );
  });
});

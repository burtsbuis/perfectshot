import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { writerSchema } from "../stage2/nodes";
import type Anthropic from "@anthropic-ai/sdk";
import { maxWords, structuredCall, toolSchema } from "../structured";

const n = (k: number) => Array.from({ length: k }, () => "word").join(" ");

describe("word limits", () => {
  it("are visible to the model in the tool schema", () => {
    const json = JSON.stringify(toolSchema(writerSchema(["golden_evening"])));
    assert.match(json, /"settingsWhy":\{"type":"string","description":"At most 30 words\."\}/);
    assert.match(json, /"summary":\{"type":"string","description":"At most 40 words\."\}/);
  });
  it("keep the limit when a field also has a hint", async () => {
    const { lightSchema, posesSchema } = await import("../stage2/nodes");
    const light = JSON.stringify(toolSchema(lightSchema([{ id: "golden_evening", kind: "golden" }])));
    assert.match(light, /"siteNotes":\{"type":"string","description":"Where at this location[^"]*At most 45 words\."/);
    assert.match(JSON.stringify(toolSchema(posesSchema(["a", "b", "c"]))), /tailored to this spot\. At most 15 words\./);
    // every string field in every node schema states a limit
    for (const json of [light, JSON.stringify(toolSchema(writerSchema(["golden_evening"])))]) {
      const strings = [...json.matchAll(/"type":"string"(,"description":"([^"]*)")?/g)].filter((m) => !/"enum"/.test(json.slice(m.index!, m.index! + 60)));
      for (const m of strings) if (m[2] !== undefined) assert.match(m[2], /At most \d+ words/);
    }
  });

  it("only allow daylight windows with open shade", async () => {
    const { lightSchema } = await import("../stage2/nodes");
    const schema = lightSchema([{ id: "golden_evening", kind: "golden" }, { id: "late_afternoon", kind: "daylight" }]);
    const base = { strategy: "backlight", siteNotes: "Beach.", tips: [], weatherCaveat: "Clear.", backupPlan: "Trees." };
    const bad = schema.safeParse({ ...base, windows: [{ id: "golden_evening", why: "Warm." }, { id: "late_afternoon", why: "Bright." }] });
    assert.ok(!bad.success);
    assert.match(bad.error!.issues[0].message, /plain daylight: only use it with the subject in open shade/);
    assert.ok(schema.safeParse({ ...base, windows: [{ id: "golden_evening", why: "Warm." }, { id: "late_afternoon", why: "Shade.", openShade: true }] }).success);
  });

  it("tolerate a small overrun and report the count when rejecting", () => {
    const s = z.object({ why: maxWords(30) });
    assert.ok(s.safeParse({ why: n(37) }).success); // within 25% slack
    const r = s.safeParse({ why: n(41) });
    assert.ok(!r.success);
    assert.match(r.error!.issues[0].message, /This is 41 words; the limit is 30/);
  });
});

describe("structuredCall", () => {
  const schema = z.object({ a: z.number(), b: z.number() });
  const msg = (content: unknown[]) => ({ content, stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as Anthropic.Messages.Message;

  it("merges an answer split across several parallel calls", async () => {
    const r = await structuredCall({
      create: async () => msg([{ type: "tool_use", id: "t1", name: "submit", input: { a: 1 } }, { type: "tool_use", id: "t2", name: "submit", input: { b: 2 } }]),
      model: "fake", system: "", user: "", toolName: "submit", toolDescription: "", schema,
    });
    assert.deepEqual(r.value, { a: 1, b: 2 });
  });

  it("answers every tool_use when asking for a fix (or the API rejects the request)", async () => {
    const sent: Anthropic.Messages.MessageCreateParamsNonStreaming[] = [];
    const replies = [
      msg([{ type: "tool_use", id: "t1", name: "submit", input: { a: 1 } }, { type: "tool_use", id: "t2", name: "other", input: {} }]),
      msg([{ type: "tool_use", id: "t3", name: "submit", input: { a: 1, b: 2 } }]),
    ];
    await structuredCall({
      create: async (p) => { sent.push(structuredClone(p)); return replies[sent.length - 1]; },
      model: "fake", system: "", user: "", toolName: "submit", toolDescription: "", schema,
    });
    const results = sent[1].messages.at(-1)!.content as Anthropic.Messages.ToolResultBlockParam[];
    assert.deepEqual(results.map((r) => r.tool_use_id), ["t1", "t2"]);
    assert.match(String(results[0].content), /b: /);
  });
});

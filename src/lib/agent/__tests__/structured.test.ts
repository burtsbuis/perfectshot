import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { writerSchema } from "../stage2/nodes";
import { maxWords, toolSchema } from "../structured";

const n = (k: number) => Array.from({ length: k }, () => "word").join(" ");

describe("word limits", () => {
  it("are visible to the model in the tool schema", () => {
    const json = JSON.stringify(toolSchema(writerSchema(["golden_evening"])));
    assert.match(json, /"settingsWhy":\{"type":"string","description":"At most 30 words\."\}/);
    assert.match(json, /"summary":\{"type":"string","description":"At most 40 words\."\}/);
  });
  it("keep the limit when a field also has a hint", async () => {
    const { lightSchema, posesSchema } = await import("../stage2/nodes");
    const light = JSON.stringify(toolSchema(lightSchema(["golden_evening"])));
    assert.match(light, /"siteNotes":\{"type":"string","description":"Where at this location[^"]*At most 45 words\."/);
    assert.match(JSON.stringify(toolSchema(posesSchema(["a", "b", "c"]))), /tailored to this spot\. At most 15 words\./);
    // every string field in every node schema states a limit
    for (const json of [light, JSON.stringify(toolSchema(writerSchema(["golden_evening"])))]) {
      const strings = [...json.matchAll(/"type":"string"(,"description":"([^"]*)")?/g)].filter((m) => !/"enum"/.test(json.slice(m.index!, m.index! + 60)));
      for (const m of strings) if (m[2] !== undefined) assert.match(m[2], /At most \d+ words/);
    }
  });

  it("tolerate a small overrun and report the count when rejecting", () => {
    const s = z.object({ why: maxWords(30) });
    assert.ok(s.safeParse({ why: n(37) }).success); // within 25% slack
    const r = s.safeParse({ why: n(41) });
    assert.ok(!r.success);
    assert.match(r.error!.issues[0].message, /This is 41 words; the limit is 30/);
  });
});

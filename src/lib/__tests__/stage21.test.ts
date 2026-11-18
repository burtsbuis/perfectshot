import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lightSchema, settingsSchema, writerSchema } from "../agent/stage2/nodes";
import { buildFacts } from "../facts";
import { buildCandidates, settingsNoteFor } from "../windows";
import { bakerReq, fakeOpenMeteo } from "./fixtures";

const NOW = new Date("2026-11-10T12:00:00Z");

describe("Stage 2.1 fixes", () => {
  it("computes how to adapt settings for a darker window", async () => {
    const facts = await buildFacts(bakerReq, { fetch: fakeOpenMeteo(), now: NOW });
    const c = buildCandidates(bakerReq, facts);
    const blue = c.find((w) => w.id === "blue_evening")!;
    const golden = c.find((w) => w.id === "golden_evening")!;
    assert.match(settingsNoteFor(golden, "backlight", facts, 35, 2, { aperture: 2.2 }), /Same settings work/);
    // f/4 at blue hour on an APS-C body still works at ISO ~1000 per the model; f/4 on a group with a 3200-ISO body does not
    assert.match(settingsNoteFor(blue, "backlight", facts, 35, 2, { aperture: 4 }), /Same settings work; expect Auto ISO around 1600/);
    const d3500 = { ...facts, gear: { ...facts.gear, body: { ...facts.gear.body, maxUsableIso: 800 } } };
    assert.match(settingsNoteFor(blue, "backlight", d3500, 35, 2, { aperture: 4 }), /Open up to f\/(1\.8|2|2\.8)/);
  });

  it("makes the photographer's own time window the main plan", async () => {
    const req = { ...bakerReq, timeWindow: { start: "11:00", end: "14:00" } };
    const facts = await buildFacts(req, { fetch: fakeOpenMeteo(), now: NOW });
    const schema = lightSchema(buildCandidates(req, facts), { userWindowFirst: true });
    const base = { strategy: "open_shade", siteNotes: "Under the cypress trees.", tips: [], weatherCaveat: "Clear.", backupPlan: "Trees." };
    const bad = schema.safeParse({ ...base, windows: [{ id: "golden_evening", why: "Better." }, { id: "your_window", why: "Yours.", openShade: true }] });
    assert.ok(!bad.success && /your_window must be first/.test(bad.error.issues[0].message));
    assert.ok(schema.safeParse({ ...base, windows: [{ id: "your_window", why: "Yours.", openShade: true }, { id: "golden_evening", why: "Better." }] }).success);
  });

  it("rejects eye-AF settings on a body without it", async () => {
    const req = { ...bakerReq, gear: { bodyId: "nikon-d3500", lensId: "nikon-afp-18-55" } };
    const facts = await buildFacts(req, { fetch: fakeOpenMeteo(), now: NOW });
    const best = buildCandidates(req, facts).find((w) => w.id === "golden_evening")!;
    const s = settingsSchema(facts, best, "backlight", 2);
    const base = { mode: "aperture_priority", focalLengthMm: 35, aperture: 5.6, shutterSpeed: "1/160", iso: "auto", whiteBalance: "Cloudy", why: "Ok." };
    const r = s.safeParse({ ...base, focusMode: "AF-C with eye AF" });
    assert.ok(!r.success && r.error.issues.some((i) => /no eye-detection autofocus/.test(i.message)));
    assert.ok(s.safeParse({ ...base, focusMode: "AF-S, single point on the nearest eye" }).success);
  });

  it("keeps the writer from giving phone tips or eye-AF tips the camera can't use", () => {
    const schema = writerSchema(["golden_evening"], { eyeAf: false, cameraName: "Nikon D3500" });
    const ok = {
      summary: "Shoot at golden hour.",
      windowWhy: [{ id: "golden_evening", why: "Warm light." }],
      subjectPlacement: "By the railing.",
      photographerPlacement: "On the steps.",
      tips: ["Put the focus point on the nearest eye."],
      settingsWhy: "Bright enough.",
      weatherCaveat: "Clear.",
      backupPlan: "Under the bridge.",
      checklist: ["Batteries", "Lens cloth", "Jacket"],
    };
    assert.ok(schema.safeParse(ok).success);
    assert.ok(!schema.safeParse({ ...ok, tips: ["Tap their face on your phone screen."] }).success);
    assert.ok(!schema.safeParse({ ...ok, tips: ["Turn on Eye AF."] }).success);
  });
});

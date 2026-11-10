import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exposureOptions, minShutter, subjectEv } from "../exposure";
import { buildFacts } from "../facts";
import { getBody, getLens } from "../gear";
import { orientation } from "../orientation";
import { buildCandidates, exposureFor } from "../windows";
import { bakerReq, fakeOpenMeteo } from "./fixtures";

const NOW = new Date("2026-11-10T12:00:00Z");
const a6400 = getBody("sony-a6400")!;
const fe35 = getLens("sony-e-35-f18")!;

describe("exposure model", () => {
  it("matches the sunny-16 rule with a high sun", () => {
    const ev = subjectEv(50, 0, "direct");
    assert.ok(ev > 14.9 && ev < 15.4, String(ev));
    // f/16 at 1/125 should need about ISO 100 in full sun
    const iso = (100 * 16 * 16 * 125) / 2 ** ev;
    assert.ok(iso > 70 && iso < 140, String(iso));
  });
  it("gets darker toward and after sunset, and in shade", () => {
    assert.ok(subjectEv(2, 0, "direct") < subjectEv(20, 0, "direct"));
    assert.ok(subjectEv(-5, 0, "direct") < 7);
    assert.ok(subjectEv(30, 0, "shade") <= subjectEv(30, 0, "direct") - 2.5);
    assert.ok(subjectEv(30, 100, "direct") < subjectEv(30, 0, "direct") - 1.5);
  });
  it("flags settings the camera can't reach in dim light", () => {
    const dim = exposureOptions(4, a6400, fe35, 35, 2); // end of blue hour
    assert.ok(dim.options.some((o) => !o.withinIsoLimit));
    const bright = exposureOptions(14, a6400, fe35, 35, 2);
    assert.ok(bright.options.every((o) => o.withinIsoLimit));
    assert.equal(bright.options[0].aperture, 1.8);
  });
  it("requires faster shutters for groups and unstabilized long lenses", () => {
    assert.equal(minShutter(a6400, fe35, 35, 4), 1 / 250);
    assert.ok(minShutter(getBody("canon-t7")!, getLens("canon-ef-50-f18")!, 50, 1) <= 1 / 160);
  });
});

describe("candidate windows", () => {
  it("offers exact sun-computed windows with weather and brightness", async () => {
    const facts = await buildFacts(bakerReq, { fetch: fakeOpenMeteo(), now: NOW });
    const c = buildCandidates(bakerReq, facts);
    const ids = c.map((w) => w.id);
    assert.deepEqual(ids, ["blue_morning", "golden_morning", "late_afternoon", "golden_evening", "blue_evening"]);
    const ge = c.find((w) => w.id === "golden_evening")!;
    assert.equal(ge.start, facts.sun.goldenHourEvening!.start);
    assert.equal(ge.local, "4:16 PM–4:55 PM");
    assert.equal(ge.sunAtMid.compass, "WSW");
    assert.ok(ge.weather && ge.weather.rainPct === 10);
    assert.ok(ge.brightness.direct > c.find((w) => w.id === "blue_evening")!.brightness.direct);
  });

  it("handles a winter day where the sun never gets high (Reykjavík)", async () => {
    const req = { ...bakerReq, location: { lat: 64.1417, lng: -21.9266 }, date: "2026-12-21" };
    const facts = await buildFacts(req, { fetch: fakeOpenMeteo(), now: NOW });
    assert.equal(facts.sun.lowSunAllDay, true);
    const ids = buildCandidates(req, facts).map((w) => w.id);
    assert.ok(ids.includes("low_sun_day"));
    assert.ok(!ids.includes("golden_evening"));
  });

  it("turns the user's local time window into exact UTC times", async () => {
    const req = { ...bakerReq, timeWindow: { start: "11:00", end: "14:00" } };
    const facts = await buildFacts(req, { fetch: fakeOpenMeteo(), now: NOW });
    const yours = buildCandidates(req, facts).find((w) => w.id === "your_window")!;
    assert.equal(yours.start, "2026-11-20T19:00:00.000Z"); // 11:00 PST = 19:00 UTC
    assert.equal(yours.local, "11:00 AM–2:00 PM");
  });

  it("gives backlit faces less light than direct sun", async () => {
    const facts = await buildFacts(bakerReq, { fetch: fakeOpenMeteo(), now: NOW });
    const ge = buildCandidates(bakerReq, facts).find((w) => w.id === "golden_evening")!;
    assert.ok(exposureFor(ge, "backlight", facts, 35, 2).ev < exposureFor(ge, "front_light", facts, 35, 2).ev);
  });
});

describe("orientation", () => {
  it("puts the photographer opposite the sun for backlight", () => {
    const o = orientation("backlight", 241);
    assert.equal(o.subjectFacesDeg, 61);
    assert.equal(o.cameraFacesDeg, 241);
    assert.match(o.sentence, /Subject faces ENE.*toward the WSW/);
  });
  it("puts the sun behind the photographer for front light", () => {
    const o = orientation("front_light", 90);
    assert.equal(o.photographerSideDeg, 90);
    assert.equal(o.cameraFacesDeg, 270);
  });
});

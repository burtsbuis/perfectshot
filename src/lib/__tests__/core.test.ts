import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { angleDiff, allPassed, runChecks } from "../checks";
import { buildFacts } from "../facts";
import { getLens, maxApertureAt } from "../gear";
import { findPoses } from "../poses";
import { getSunFacts } from "../sun";
import { daysFromToday, getWeather, localToIso } from "../weather";
import { bakerReq, fakeOpenMeteo, goodBakerPlan } from "./fixtures";

const NOW = new Date("2026-11-10T12:00:00Z"); // makes Nov 20 forecastable

describe("gear", () => {
  it("interpolates zoom apertures conservatively", () => {
    const kit = getLens("canon-rfs-18-45")!;
    assert.equal(maxApertureAt(kit, 18), 4.5);
    assert.equal(maxApertureAt(kit, 45), 6.3);
    assert.equal(maxApertureAt(kit), 6.3); // unknown focal → tele end (safe everywhere)
    assert.ok(maxApertureAt(kit, 30) > 4.5 && maxApertureAt(kit, 30) < 6.3);
    assert.equal(maxApertureAt(getLens("sony-e-35-f18")!), 1.8);
  });
});

describe("poses", () => {
  it("only returns poses for the subject count, best light match first", () => {
    const p = findPoses({ subjects: 2, light: "backlight" });
    assert.ok(p.length >= 5);
    assert.ok(p.every((x) => x.subjects.includes(2)));
    assert.ok(p[0].light.includes("backlight"));
  });
});

describe("weather", () => {
  it("converts Open-Meteo local times to UTC", () => {
    assert.equal(localToIso("2026-11-20T16:00", -28800), "2026-11-21T00:00:00.000Z");
  });
  it("knows the forecast horizon", () => {
    assert.equal(daysFromToday("2026-11-20", NOW), 10);
  });
  it("returns a forecast in range and null beyond it", async () => {
    const near = await getWeather(37.79, -122.48, "2026-11-20", { fetch: fakeOpenMeteo(), now: NOW });
    assert.equal(near.timezone, "America/Los_Angeles");
    assert.equal(near.weather?.hourly.length, 24);
    const far = await getWeather(37.79, -122.48, "2027-06-01", { fetch: fakeOpenMeteo(), now: NOW });
    assert.equal(far.weather, null);
    assert.equal(far.timezone, "America/Los_Angeles");
  });
});

describe("checks", () => {
  const facts = () => buildFacts(bakerReq, { fetch: fakeOpenMeteo(), now: NOW });

  it("passes a good plan", async () => {
    const r = runChecks(goodBakerPlan(), bakerReq, await facts());
    assert.ok(allPassed(r), JSON.stringify(r.filter((c) => c.status === "fail")));
  });

  it("catches an impossible aperture", async () => {
    const p = goodBakerPlan();
    p.settings.aperture = 1.4;
    const r = runChecks(p, bakerReq, await facts());
    assert.equal(r.find((c) => c.id === "aperture")?.status, "fail");
  });

  it("catches a wrong sun direction", async () => {
    const p = goodBakerPlan();
    p.lighting.sunDirectionAtBestTime.azimuthDeg = 120; // that's the morning side
    assert.equal(runChecks(p, bakerReq, await facts()).find((c) => c.id === "sun_direction")?.status, "fail");
  });

  it("catches ignored rain", async () => {
    const f = await buildFacts(bakerReq, { fetch: fakeOpenMeteo(80), now: NOW });
    assert.equal(runChecks(goodBakerPlan(), bakerReq, f).find((c) => c.id === "rain")?.status, "fail");
  });

  it("catches midday windows and wrong-size poses", async () => {
    const p = goodBakerPlan();
    p.recommendedWindows[0] = { ...p.recommendedWindows[0], start: "2026-11-20T20:00:00Z", end: "2026-11-20T21:00:00Z", label: "Noon", why: "Bright" };
    p.poses[0].libraryId = "g4-huddle";
    const r = runChecks(p, bakerReq, await facts());
    assert.equal(r.find((c) => c.id === "windows")?.status, "fail");
    assert.equal(r.find((c) => c.id === "poses")?.status, "fail");
  });

  it("catches exposure compensation in full manual", async () => {
    const p = goodBakerPlan();
    p.settings = { ...p.settings, mode: "manual", iso: 400, exposureCompensation: 0.7 };
    assert.equal(runChecks(p, bakerReq, await facts()).find((c) => c.id === "settings_consistency")?.status, "fail");
    p.settings.iso = "auto"; // manual + Auto ISO: compensation does work
    assert.equal(runChecks(p, bakerReq, await facts()).find((c) => c.id === "settings_consistency")?.status, "pass");
  });

  it("places blue hour right after sunset", () => {
    const f = getSunFacts(bakerReq.location.lat, bakerReq.location.lng, bakerReq.date);
    assert.equal(f.blueHourEvening?.start, f.sunset);
    const mins = (Date.parse(f.blueHourEvening!.end) - Date.parse(f.blueHourEvening!.start)) / 60000;
    assert.ok(mins > 20 && mins < 40, `civil twilight in SF in November is ~28 min, got ${mins}`);
  });

  it("wraps angle differences around north", () => {
    assert.equal(angleDiff(355, 5), 10);
  });
});

describe("timezone", () => {
  it("is known even when the weather service is down", async () => {
    const down = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const { buildFacts: bf } = await import("../facts");
    const f = await bf(bakerReq, { fetch: down, now: NOW });
    assert.equal(f.timezone, "America/Los_Angeles");
    assert.equal(f.weather, null);
  });
});

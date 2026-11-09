import { getSunFacts, compassLabel } from "../src/lib/sun";

// Baker Beach, San Francisco — eval scenario #1
const f = getSunFacts(37.7936, -122.4836, "2026-11-20");
const fmt = (s: string | null) =>
  s ? new Date(s).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }) : "—";
console.log("Sunrise", fmt(f.sunrise), "| Sunset", fmt(f.sunset));
console.log("Evening golden hour", fmt(f.goldenHourEvening?.start ?? null), "→", fmt(f.goldenHourEvening?.end ?? null));
const last = f.positions.filter((p) => p.altitudeDeg > 0).at(-1)!;
console.log("Sun near sunset:", last.azimuthDeg + "°", compassLabel(last.azimuthDeg), "alt", last.altitudeDeg + "°");

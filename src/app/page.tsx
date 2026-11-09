import { getSunFacts, compassLabel } from "@/lib/sun";

// Placeholder home page: proves the sun engine works end to end.
// The planner UI (map, gear picker, plan view) comes next.
export default function Home() {
  const facts = getSunFacts(37.7936, -122.4836, "2026-11-20");
  const tz = "America/Los_Angeles";
  const fmt = (s: string | null | undefined) =>
    s ? new Date(s).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }) : "—";
  const lastLight = facts.positions.filter((p) => p.altitudeDeg > 0).at(-1);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <p className="text-sm uppercase tracking-[0.2em] text-amber-400">PerfectShot</p>
      <h1 className="mt-3 text-4xl font-semibold leading-tight">Plan your portrait shoot around the light.</h1>
      <p className="mt-4 text-stone-400">
        Tell us where, when, and what camera you have. We&apos;ll tell you when to shoot, where to stand,
        what settings to use, and how to pose.
      </p>

      <section className="mt-10 rounded-2xl border border-stone-800 bg-stone-900/60 p-6">
        <h2 className="text-sm font-medium text-stone-400">Sun engine check: Baker Beach, SF · Nov 20</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-stone-500">Sunrise</dt><dd className="text-lg">{fmt(facts.sunrise)}</dd></div>
          <div><dt className="text-stone-500">Sunset</dt><dd className="text-lg">{fmt(facts.sunset)}</dd></div>
          <div>
            <dt className="text-stone-500">Evening golden hour</dt>
            <dd className="text-lg text-amber-300">
              {fmt(facts.goldenHourEvening?.start)} – {fmt(facts.goldenHourEvening?.end)}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Sun at last light</dt>
            <dd className="text-lg">
              {lastLight ? `${Math.round(lastLight.azimuthDeg)}° ${compassLabel(lastLight.azimuthDeg)}` : "—"}
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

import { Planner } from "@/components/Planner";
import { BODIES, LENSES } from "@/lib/gear";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 pt-8 sm:px-8 sm:pt-12">
      <header className="mb-10 max-w-2xl sm:mb-14">
        <p className="font-display text-lg font-semibold">
          Perfect<span className="text-gold">Shot</span>
        </p>
        <h1 className="mt-6 font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
          Know where the light will be before you get there.
        </h1>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-haze">
          Pick a spot, a date, and your camera. You&apos;ll get the best time to shoot, where to stand, what settings to use,
          and how to pose your people.
        </p>
      </header>
      <Planner bodies={BODIES} lenses={LENSES} />
    </main>
  );
}

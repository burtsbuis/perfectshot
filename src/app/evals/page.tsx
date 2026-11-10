import type { Metadata } from "next";
import Link from "next/link";
import { EvalRunner } from "@/components/EvalRunner";
import { SCENARIOS } from "@/lib/evals/scenarios";

export const metadata: Metadata = {
  title: "Evals: PerfectShot",
  robots: { index: false, follow: false },
};

export default function EvalsPage() {
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 pt-8 sm:px-8 sm:pt-12">
      <Link href="/" className="font-display text-lg font-semibold">
        Perfect<span className="text-gold">Shot</span>
      </Link>
      <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Agent scorecard</h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-haze">
        Ten fixed test shoots, each chosen to probe one weakness: slow kit lenses, harsh midday sun, rain, a polar winter day,
        a cliff edge. Every plan gets the eight fact checks plus a 1–5 score from an AI judge on usefulness, light reasoning,
        clarity, and specificity. Run this after each change to the agent to see whether it helped.
      </p>
      <div className="mt-8">
        <EvalRunner scenarios={SCENARIOS.map(({ id, name, tests }) => ({ id, name, tests }))} model={model} />
      </div>
    </main>
  );
}

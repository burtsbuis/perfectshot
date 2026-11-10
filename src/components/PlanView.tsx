"use client";

import { useState } from "react";
import type { PlanResponse } from "@/lib/api";
import { SunCompass } from "./SunCompass";

const STRATEGY_LABEL: Record<string, string> = {
  backlight: "Backlight",
  side_light: "Side light",
  front_light: "Front light",
  open_shade: "Open shade",
  overcast_soft: "Soft overcast light",
};

const MODE_LABEL = { aperture_priority: "Aperture priority (A / Av)", manual: "Manual (M)" } as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-dusk-3 py-7">
      <h3 className="font-display text-xl font-semibold tracking-tight">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function PlanView({ data, placeName }: { data: PlanResponse; placeName?: string }) {
  const { plan, timezone, checks, meta } = data;
  const t = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  const windows = [...plan.recommendedWindows].sort((a, b) => a.rank - b.rank);
  const best = windows[0];
  const s = plan.settings;
  const [done, setDone] = useState<Set<number>>(new Set());
  const failed = checks.filter((c) => c.status === "fail");

  const readouts: { label: string; value: string }[] = [
    { label: "Aperture", value: `f/${s.aperture}` },
    { label: "Shutter", value: s.shutterSpeed },
    { label: "ISO", value: s.iso === "auto" ? "Auto" : String(s.iso) },
    ...(s.exposureCompensation !== undefined ? [{ label: "Exposure comp.", value: `${s.exposureCompensation > 0 ? "+" : ""}${s.exposureCompensation}` }] : []),
    ...(s.focalLengthMm ? [{ label: "Zoom to", value: `${s.focalLengthMm}mm` }] : []),
  ];

  return (
    <article aria-live="polite">
      {/* The answer first: when, and how the light falls */}
      <div className="grid gap-8 pb-8 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <p className="text-haze">{placeName ? `Your plan for ${placeName}` : "Your plan"}</p>
          <p className="mt-3 font-display text-5xl font-semibold leading-none tracking-tight text-gold sm:text-6xl">
            <span className="whitespace-nowrap">{t(best.start)}</span><span className="text-gold/60">–</span>{" "}
            <span className="whitespace-nowrap">{t(best.end)}</span>
          </p>
          <p className="mt-2 font-display text-lg">{best.label}</p>
          <p className="mt-4 max-w-prose leading-relaxed text-paper/90">{plan.summary}</p>
        </div>
        <SunCompass
          azimuthDeg={plan.lighting.sunDirectionAtBestTime.azimuthDeg}
          compass={plan.lighting.sunDirectionAtBestTime.compass}
          strategy={plan.lighting.strategy}
        />
      </div>

      <Section title={`Where to stand: ${STRATEGY_LABEL[plan.lighting.strategy]}`}>
        <dl className="grid gap-5 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-haze">Your subject</dt>
            <dd className="mt-1 leading-relaxed">{plan.lighting.subjectPlacement}</dd>
          </div>
          <div>
            <dt className="text-sm text-haze">You</dt>
            <dd className="mt-1 leading-relaxed">{plan.lighting.photographerPlacement}</dd>
          </div>
        </dl>
        {plan.lighting.tips.length > 0 && (
          <ul className="mt-5 space-y-2">
            {plan.lighting.tips.map((tip) => (
              <li key={tip} className="flex gap-3 leading-relaxed">
                <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-gold" />
                {tip}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Camera settings">
        <p className="text-sm text-haze">Mode: <span className="text-paper">{MODE_LABEL[s.mode]}</span></p>
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-dusk-3 bg-dusk-3 sm:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))]">
          {readouts.map((r) => (
            <div key={r.label} className="bg-dusk-2 px-4 py-3">
              <div className="text-xs text-haze">{r.label}</div>
              <div className="mt-0.5 font-display text-2xl font-semibold tabular-nums">{r.value}</div>
            </div>
          ))}
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="inline text-haze">Focus: </dt><dd className="inline">{s.focusMode}</dd></div>
          <div><dt className="inline text-haze">White balance: </dt><dd className="inline">{s.whiteBalance}</dd></div>
        </dl>
        <p className="mt-4 max-w-prose leading-relaxed text-paper/90">{s.why}</p>
      </Section>

      <Section title="Poses to try">
        <ul className="grid gap-4 sm:grid-cols-2">
          {plan.poses.map((p) => (
            <li key={p.name} className="rounded-xl border border-dusk-3 p-4">
              <p className="font-display text-lg font-semibold">{p.name}</p>
              <p className="text-sm text-haze">{p.bestFor}</p>
              <ul className="mt-3 space-y-1.5 text-[15px]">
                {p.instructions.map((cue) => (
                  <li key={cue}>&ldquo;{cue}&rdquo;</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-haze">Read the quoted cues out loud to your subjects.</p>
      </Section>

      {windows.length > 1 && (
        <Section title="Other good times">
          <ul className="space-y-3">
            {windows.slice(1).map((w) => (
              <li key={w.start} className="grid gap-1 sm:grid-cols-[11rem_1fr]">
                <span className="font-display font-semibold tabular-nums text-gold">{t(w.start)}–{t(w.end)}</span>
                <span><span className="font-medium">{w.label}.</span> <span className="text-paper/85">{w.why}</span></span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Weather and backup plan">
        <p className="leading-relaxed">{plan.weatherCaveat}</p>
        <p className="mt-3 leading-relaxed"><span className="font-medium text-gold">If it doesn&apos;t work out: </span>{plan.backupPlan}</p>
      </Section>

      {plan.checklist.length > 0 && (
        <Section title="Before you leave">
          <ul className="space-y-2">
            {plan.checklist.map((item, i) => (
              <li key={item}>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={done.has(i)}
                    onChange={() => setDone((d) => { const n = new Set(d); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                    className="mt-1 size-4 accent-gold"
                  />
                  <span className={done.has(i) ? "text-haze line-through" : ""}>{item}</span>
                </label>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* For the curious (and for portfolio reviewers): how the agent got here */}
      <details className="group border-t border-dusk-3 py-6">
        <summary className="cursor-pointer list-none font-display text-lg font-semibold">
          <span className="mr-2 inline-block transition-transform group-open:rotate-90" aria-hidden>›</span>
          How this plan was made
          <span className="ml-3 align-middle text-sm font-normal text-haze">
            {failed.length ? `${failed.length} check${failed.length > 1 ? "s" : ""} flagged` : "All checks passed"}
          </span>
        </summary>
        <div className="mt-5 grid gap-8 lg:grid-cols-2">
          <div>
            <h4 className="text-sm text-haze">Fact checks on the plan</h4>
            <ul className="mt-2 space-y-1.5 text-sm">
              {checks.map((c) => (
                <li key={c.id} className="flex gap-2">
                  <span aria-hidden className={c.status === "pass" ? "text-sage" : c.status === "fail" ? "text-rose" : "text-haze"}>
                    {c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "–"}
                  </span>
                  <span className="sr-only">{c.status}</span>
                  <span className={c.status === "fail" ? "text-rose" : "text-paper/85"}>{c.message}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-sm text-haze">
              Agent steps (stage {meta.agentStage}, {meta.turns} turns, {(meta.latencyMs / 1000).toFixed(1)}s, {(meta.usage.inputTokens + meta.usage.outputTokens).toLocaleString()} tokens)
            </h4>
            <ol className="mt-2 space-y-1 text-sm">
              {meta.trace.map((step, i) =>
                step.type === "model" ? (
                  <li key={i} className="text-haze">Turn {step.turn}: Claude thought for {(step.ms / 1000).toFixed(1)}s</li>
                ) : (
                  <li key={i} className={`pl-4 ${step.error ? "text-rose" : "text-paper/85"}`}>
                    {step.name}{step.error ? `, failed: ${step.error.split("\n")[0]}` : ""}
                  </li>
                ),
              )}
            </ol>
          </div>
        </div>
      </details>
    </article>
  );
}

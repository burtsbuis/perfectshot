"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PlanResponse } from "@/lib/api";
import type { Body, Lens, PlanRequest } from "@/lib/schema";
import { LocationPicker, type PickedLocation } from "./LocationPicker";
import { PlanView } from "./PlanView";

const VIBES = [
  { id: "natural", label: "Natural" },
  { id: "bright_airy", label: "Bright and airy" },
  { id: "moody", label: "Moody" },
  { id: "editorial", label: "Editorial" },
] as const;
type Vibe = (typeof VIBES)[number]["id"];

const SUBJECTS = [
  { n: 1, label: "1 person" },
  { n: 2, label: "Couple" },
  { n: 3, label: "3 people" },
  { n: 4, label: "Group of 4+" },
] as const;

// Honest progress copy: these are the agent's actual jobs, shown on a timer
const PROGRESS = [
  "Working out where the sun will be",
  "Checking the forecast",
  "Matching settings to your camera",
  "Picking poses for the light",
  "Writing up your plan",
];

const noop = () => () => {};
const isoDay = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const field = "w-full rounded-lg border border-dusk-3 bg-dusk px-3 py-2.5 text-paper";
const labelCls = "mb-1.5 block text-sm font-medium";

export function Planner({ bodies, lenses }: { bodies: Body[]; lenses: Lens[] }) {
  const [location, setLocation] = useState<PickedLocation | null>(null);
  // "Today" depends on the visitor's clock: empty on the server, real on the client (no hydration mismatch)
  const today = useSyncExternalStore(noop, () => isoDay(new Date()), () => "");
  const [pickedDate, setDate] = useState("");
  const date = pickedDate || (today ? isoDay(new Date(Date.parse(today) + 3 * 86400000 + 43200000)) : "");
  const [bodyId, setBodyId] = useState("");
  const [lensId, setLensId] = useState("");
  const [subjects, setSubjects] = useState<1 | 2 | 3 | 4>(1);
  const [vibe, setVibe] = useState<Vibe | undefined>();
  const [notes, setNotes] = useState("");

  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [result, setResult] = useState<PlanResponse | null>(null);
  const [progress, setProgress] = useState(0);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state !== "loading") return;
    const id = setInterval(() => setProgress((p) => Math.min(p + 1, PROGRESS.length - 1)), 6000);
    return () => clearInterval(id);
  }, [state]);

  const body = bodies.find((b) => b.id === bodyId);
  const fittingLenses = body ? lenses.filter((l) => l.mounts.includes(body.mount)) : [];
  const brands = [...new Set(bodies.map((b) => b.brand))];
  const daysOut = date && today ? Math.round((Date.parse(date) - Date.parse(today)) / 86400000) : 0;

  const missing = [!location && "a location", !date && "a date", !bodyId && "your camera", !lensId && "your lens"].filter(Boolean) as string[];

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (missing.length || !location) return;
    const req: PlanRequest = {
      location,
      date,
      gear: { bodyId, lensId },
      subjects,
      ...(vibe ? { vibe } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    setProgress(0);
    setState("loading");
    setError("");
    setErrorDetail("");
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    try {
      const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
      const data = await res.json();
      if (!res.ok) {
        setErrorDetail([data.detail, `HTTP ${res.status}`].filter(Boolean).join(" · "));
        throw new Error(data.error ?? "Something went wrong generating the plan.");
      }
      setResult(data as PlanResponse);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong generating the plan.");
      setState("error");
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-14">
      <form onSubmit={generate} className="space-y-7" aria-label="Plan a shoot">
        <fieldset>
          <legend className="font-display text-lg font-semibold">Where are you shooting?</legend>
          <div className="mt-3">
            <LocationPicker value={location} onChange={setLocation} />
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="font-display text-lg font-semibold">When and who</legend>
          <div>
            <label htmlFor="date" className={labelCls}>Date</label>
            <input id="date" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className={field} required />
            {daysOut >= 16 && <p className="mt-1.5 text-sm text-haze">That&apos;s more than 16 days away, so the plan won&apos;t include a forecast.</p>}
          </div>
          <div role="radiogroup" aria-label="Who are you photographing?">
            <span className={labelCls}>Who are you photographing?</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
              {SUBJECTS.map((s) => (
                <button
                  key={s.n}
                  type="button"
                  role="radio"
                  aria-checked={subjects === s.n}
                  onClick={() => setSubjects(s.n)}
                  className={`rounded-lg border px-3 py-2 text-sm ${subjects === s.n ? "border-gold bg-gold/10 text-paper" : "border-dusk-3 text-haze hover:text-paper"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="font-display text-lg font-semibold">Your camera</legend>
          <div>
            <label htmlFor="body" className={labelCls}>Camera body</label>
            <select id="body" value={bodyId} onChange={(e) => { setBodyId(e.target.value); setLensId(""); }} className={field} required>
              <option value="">Choose your camera</option>
              {brands.map((brand) => (
                <optgroup key={brand} label={brand}>
                  {bodies.filter((b) => b.brand === brand).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="lens" className={labelCls}>Lens</label>
            <select id="lens" value={lensId} onChange={(e) => setLensId(e.target.value)} className={field} disabled={!body} required>
              <option value="">{body ? "Choose your lens" : "Pick a camera first"}</option>
              {fittingLenses.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {body && <p className="mt-1.5 text-sm text-haze">Showing lenses that fit the {body.mount} mount.</p>}
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="font-display text-lg font-semibold">Look and feel <span className="text-sm font-normal text-haze">(optional)</span></legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Vibe">
            {VIBES.map((v) => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={vibe === v.id}
                onClick={() => setVibe(vibe === v.id ? undefined : v.id)}
                className={`rounded-full border px-3.5 py-1.5 text-sm ${vibe === v.id ? "border-gold bg-gold/10" : "border-dusk-3 text-haze hover:text-paper"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="notes" className={labelCls}>Anything else?</label>
            <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2}
              placeholder="e.g. engagement shoot, they want the bridge in the background"
              className={`${field} resize-y placeholder:text-haze/70`} />
          </div>
        </fieldset>

        <div>
          <button
            type="submit"
            disabled={state === "loading" || missing.length > 0}
            className="w-full rounded-xl bg-gold px-5 py-3.5 font-display text-lg font-semibold text-dusk hover:bg-[#f7c766] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state === "loading" ? "Planning your shoot…" : "Plan my shoot"}
          </button>
          {missing.length > 0 && <p className="mt-2 text-sm text-haze">Add {missing.join(", ").replace(/, ([^,]*)$/, " and $1")} to continue.</p>}
        </div>
      </form>

      <div ref={resultRef} className="scroll-mt-6">
        {state === "idle" && !result && (
          <div className="rounded-2xl border border-dashed border-dusk-3 p-8 text-haze">
            <p className="font-display text-xl text-paper">Your shot plan will appear here.</p>
            <p className="mt-3 max-w-prose leading-relaxed">
              You&apos;ll get the best time to shoot, a diagram of where the sun will be and where you and your subject should stand,
              starting settings for your exact camera and lens, and poses to try.
            </p>
          </div>
        )}

        {state === "loading" && (
          <div className="rounded-2xl border border-dusk-3 bg-dusk-2/60 p-8" role="status">
            <div className="flex items-center gap-4">
              <span aria-hidden className="relative flex size-4">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-gold opacity-60" />
                <span className="relative inline-flex size-4 rounded-full bg-gold" />
              </span>
              <p className="font-display text-xl">{PROGRESS[progress]}…</p>
            </div>
            <p className="mt-3 text-sm text-haze">This usually takes 20 to 40 seconds.</p>
          </div>
        )}

        {state === "error" && (
          <div className="rounded-2xl border border-rose/50 p-6" role="alert">
            <p className="font-display text-lg text-rose">The plan didn&apos;t come through.</p>
            <p className="mt-2">{error}</p>
            <p className="mt-2 text-sm text-haze">Your choices are still filled in, so you can press Plan my shoot again.</p>
            {errorDetail && (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-haze">Technical details</summary>
                <p className="mt-2 break-words rounded-lg bg-dusk px-3 py-2 font-mono text-xs text-paper/85">{errorDetail}</p>
              </details>
            )}
          </div>
        )}

        {result && state !== "loading" && <PlanView data={result} placeName={location?.name} />}
      </div>
    </div>
  );
}

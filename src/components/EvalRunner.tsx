"use client";

import { Fragment, useState, useSyncExternalStore } from "react";
import type { PlanResponse } from "@/lib/api";
import type { CheckResult } from "@/lib/checks";
import type { JudgeScores, RubricKey } from "@/lib/evals/judge";
import { PlanView } from "./PlanView";

type ScenarioInfo = { id: number; name: string; tests: string };

type Row = {
  status: "waiting" | "planning" | "judging" | "done" | "failed";
  rowId?: string;
  result?: Omit<PlanResponse, "id">;
  scores?: JudgeScores;
  error?: string;
  failedAt?: "plan" | "judge";
};

const RUBRIC_LABELS: Record<RubricKey, string> = {
  usefulness: "Useful",
  lightReasoning: "Light",
  clarity: "Clarity",
  specificity: "Specific",
};
const KEYS = Object.keys(RUBRIC_LABELS) as RubricKey[];

const STORAGE_KEY = "perfectshot-eval-password";
const noop = () => () => {};
const readStored = () => {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

const passedAll = (checks: CheckResult[]) => checks.every((c) => c.status !== "fail");
const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "—");
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function EvalRunner({ scenarios, model }: { scenarios: ScenarioInfo[]; model: string }) {
  const stored = useSyncExternalStore(noop, readStored, () => "");
  const [typed, setTyped] = useState<string | null>(null);
  const password = typed ?? stored;
  const [rows, setRows] = useState<Record<number, Row>>({});
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [runId, setRunId] = useState("");
  const [copied, setCopied] = useState(false);
  const [stage, setStage] = useState<1 | 2>(2);
  type PastRun = { runId: string; stage: number; model: string; startedAt: string; plans: number };
  const [pastRuns, setPastRuns] = useState<PastRun[] | null>(null);
  const [pastError, setPastError] = useState("");
  const [loadedRun, setLoadedRun] = useState<string | null>(null);

  const update = (id: number, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } as Row }));

  async function post<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-eval-password": password },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error([data.error ?? `HTTP ${res.status}`, data.detail].filter(Boolean).join(" · "));
    return data as T;
  }

  async function judge(scenarioId: number, rowId: string) {
    update(scenarioId, { status: "judging", error: undefined, failedAt: undefined });
    try {
      const judged = await post<{ scores: JudgeScores }>("/api/evals/judge", { rowId });
      update(scenarioId, { status: "done", scores: judged.scores });
    } catch (err) {
      update(scenarioId, { status: "failed", failedAt: "judge", error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function runOne(s: ScenarioInfo, id: string) {
    update(s.id, { status: "planning", error: undefined, failedAt: undefined, scores: undefined, result: undefined });
    try {
      const planned = await post<Omit<PlanResponse, "id"> & { rowId: string }>("/api/evals/plan", { runId: id, scenarioId: s.id, stage });
      update(s.id, { rowId: planned.rowId, result: planned });
      await judge(s.id, planned.rowId);
    } catch (err) {
      update(s.id, { status: "failed", failedAt: "plan", error: err instanceof Error ? err.message : String(err) });
      if (err instanceof Error && /password|set up/i.test(err.message)) throw err; // stop the whole run
    }
  }

  async function getJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: { "x-eval-password": password } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error([data.error ?? `HTTP ${res.status}`, data.detail].filter(Boolean).join(" · "));
    return data as T;
  }

  async function listPastRuns() {
    setPastError("");
    try {
      setPastRuns((await getJson<{ runs: PastRun[] }>("/api/evals/runs")).runs);
    } catch (err) {
      setPastError(err instanceof Error ? err.message : String(err));
    }
  }

  type StoredRow = {
    scenarioId: number;
    rowId: string;
    stage: number;
    model: string;
    plan: PlanResponse["plan"] | null;
    checks: CheckResult[] | null;
    judge: JudgeScores | null;
    timezone: string;
    error: string | null;
    latencyMs: number;
    turns: number;
    usage: { inputTokens: number; outputTokens: number };
  };

  async function loadRun(id: string) {
    setPastError("");
    try {
      const data = await getJson<{ rows: StoredRow[] }>(`/api/evals/runs?runId=${encodeURIComponent(id)}`);
      setRunId(id);
      setLoadedRun(id);
      setOpen(null);
      setRows(
        Object.fromEntries(
          data.rows.map((r) => [
            r.scenarioId,
            r.plan && r.checks
              ? ({
                  status: r.judge ? "done" : "failed",
                  failedAt: r.judge ? undefined : "judge",
                  rowId: r.rowId,
                  scores: r.judge ?? undefined,
                  error: r.judge ? undefined : "Not scored yet",
                  result: {
                    plan: r.plan,
                    checks: r.checks,
                    timezone: r.timezone,
                    meta: { agentStage: r.stage, model: r.model, latencyMs: r.latencyMs, turns: r.turns, usage: r.usage, trace: [] },
                  },
                } as Row)
              : ({ status: "failed", failedAt: "plan", error: r.error ?? "No plan" } as Row),
          ]),
        ),
      );
    } catch (err) {
      setPastError(err instanceof Error ? err.message : String(err));
    }
  }

  async function rescoreAll() {
    setRunning(true);
    for (const s of scenarios) {
      const r = rows[s.id];
      if (r?.rowId && r.result) await judge(s.id, r.rowId);
    }
    setRunning(false);
  }

  async function runAll(only?: ScenarioInfo[]) {
    setLoadedRun(null);
    const list = only ?? scenarios;
    try {
      sessionStorage.setItem(STORAGE_KEY, password);
    } catch {}
    const id = new Date().toISOString().slice(0, 16).replace("T", " ");
    setRunId(id);
    setRows(Object.fromEntries(list.map((s) => [s.id, { status: "waiting" } as Row])));
    setRunning(true);
    try {
      // One at a time: gentle on API rate limits, and progress is easy to follow
      for (const s of list) await runOne(s, id);
    } catch {
      // stopped early (auth or setup problem); the failing row shows why
    } finally {
      setRunning(false);
    }
  }

  // ---- summary ----
  const done = scenarios.map((s) => rows[s.id]).filter((r): r is Row => !!r?.result);
  const judged = done.filter((r) => r.scores);
  const ruleRate = done.length ? done.filter((r) => passedAll(r.result!.checks)).length : 0;
  const avgBy = (k: RubricKey) => mean(judged.map((r) => r.scores![k].score));
  const avgAll = mean(judged.map((r) => mean(KEYS.map((k) => r.scores![k].score))));
  const avgLatency = mean(done.map((r) => r.result!.meta.latencyMs / 1000));
  const avgTokens = mean(done.map((r) => r.result!.meta.usage.inputTokens + r.result!.meta.usage.outputTokens));
  const failures = scenarios.filter((s) => rows[s.id]?.status === "failed").length;
  const finished = !running && done.length > 0;

  function markdown() {
    const date = runId.slice(0, 10);
    const summary = `| ${date} | ${done[0]?.result?.meta.agentStage ?? stage} | ${model} | ${ruleRate}/${done.length} | ${KEYS.map((k) => fmt(avgBy(k))).join(" | ")} | ${fmt(avgLatency)}s | ${Math.round(avgTokens).toLocaleString()} tok | Run ${runId}${loadedRun ? " (re-scored)" : ""}${failures ? `, ${failures} failed` : ""} |`;
    const per = scenarios
      .map((s) => {
        const r = rows[s.id];
        if (!r?.result) return `| ${s.id} | ${s.name} | failed | | | | | ${r?.error?.slice(0, 80) ?? ""} |`;
        const failed = r.result.checks.filter((c) => c.status === "fail").map((c) => c.id);
        return `| ${s.id} | ${s.name} | ${failed.length ? `✗ ${failed.join(", ")}` : "✓ all"} | ${KEYS.map((k) => r.scores?.[k].score ?? "—").join(" | ")} | ${r.scores?.biggestWeakness ?? ""} |`;
      })
      .join("\n");
    return `${summary}\n\n| # | Scenario | Checks | Useful | Light | Clarity | Specific | Biggest weakness |\n|---|---|---|---|---|---|---|---|\n${per}`;
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-72">
          <label htmlFor="pw" className="mb-1.5 block text-sm font-medium">Eval password</label>
          <input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-lg border border-dusk-3 bg-dusk px-3 py-2.5"
          />
        </div>
        <fieldset className="flex gap-1 rounded-xl border border-dusk-3 p-1" disabled={running}>
          <legend className="sr-only">Agent version</legend>
          {([1, 2] as const).map((n) => (
            <label key={n} className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm ${stage === n ? "bg-gold/15 text-paper" : "text-haze hover:text-paper"}`}>
              <input type="radio" name="stage" value={n} checked={stage === n} onChange={() => setStage(n)} className="sr-only" />
              Stage {n}
            </label>
          ))}
        </fieldset>
        <button
          onClick={() => runAll()}
          disabled={running || !password}
          className="rounded-xl bg-gold px-5 py-2.5 font-display font-semibold text-dusk hover:bg-[#f7c766] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Running…" : `Run all ${scenarios.length} scenarios`}
        </button>
        <button
          onClick={() => runAll(scenarios.slice(0, 1))}
          disabled={running || !password}
          className="rounded-xl border border-dusk-3 px-5 py-2.5 font-display font-semibold hover:border-haze disabled:cursor-not-allowed disabled:opacity-50"
        >
          Test with 1 scenario
        </button>
      </div>
      <details className="mt-4 text-sm" onToggle={(e) => (e.currentTarget.open && !pastRuns ? listPastRuns() : undefined)}>
        <summary className="cursor-pointer text-haze hover:text-paper">Past runs: load one to view or re-score with the current judge</summary>
        <div className="mt-3 space-y-2">
          {pastError && <p className="text-rose">{pastError}</p>}
          {!pastRuns && !pastError && <p className="text-haze">{password ? "Loading…" : "Enter the password first."}</p>}
          {pastRuns?.map((r) => (
            <div key={r.runId} className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <button onClick={() => loadRun(r.runId)} disabled={running} className={`underline-offset-2 hover:underline ${loadedRun === r.runId ? "text-gold" : ""}`}>
                Run {r.runId}
              </button>
              <span className="text-haze">Stage {r.stage}, {r.plans} plans, {r.model}</span>
            </div>
          ))}
          {loadedRun && (
            <button onClick={rescoreAll} disabled={running} className="mt-2 rounded-xl bg-gold px-4 py-2 font-display font-semibold text-dusk hover:bg-[#f7c766] disabled:opacity-50">
              {running ? "Re-scoring…" : "Re-score all plans in this run"}
            </button>
          )}
        </div>
      </details>

      <p className="mt-2 text-sm text-haze">
        Runs one scenario at a time: the agent writes a plan, the fact checks run, then a judge scores it. About 5–8 minutes in total, using{" "}
        {model}. Keep this tab open.
      </p>

      {done.length > 0 && (
        <section className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-dusk-3 bg-dusk-3 sm:grid-cols-4 lg:grid-cols-7" aria-label="Summary">
          {[
            ["Passed all checks", `${ruleRate}/${done.length}`],
            ...KEYS.map((k) => [RUBRIC_LABELS[k], fmt(avgBy(k))]),
            ["Overall", fmt(avgAll)],
            ["Avg time", `${fmt(avgLatency, 0)}s`],
          ].map(([label, value]) => (
            <div key={label} className="bg-dusk-2 px-4 py-3">
              <div className="text-xs text-haze">{label}</div>
              <div className="font-display text-2xl font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </section>
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="text-haze">
            <tr className="border-b border-dusk-3">
              <th className="py-2 pr-3 font-medium">Scenario</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Checks</th>
              {KEYS.map((k) => <th key={k} className="py-2 pr-3 text-center font-medium">{RUBRIC_LABELS[k]}</th>)}
              <th className="py-2 font-medium"><span className="sr-only">Details</span></th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => {
              const r = rows[s.id];
              const failedChecks = r?.result?.checks.filter((c) => c.status === "fail") ?? [];
              return (
                <Fragment key={s.id}>
                  <tr className="border-b border-dusk-3/60 align-top">
                    <td className="py-3 pr-3">
                      <div className="font-medium">{s.id}. {s.name}</div>
                      <div className="text-haze">{s.tests}</div>
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap">
                      {!r && <span className="text-haze">Not run</span>}
                      {r?.status === "waiting" && <span className="text-haze">Waiting</span>}
                      {r?.status === "planning" && <span className="text-gold">Planning…</span>}
                      {r?.status === "judging" && <span className="text-gold">Scoring…</span>}
                      {r?.status === "done" && <span className="text-sage">Done</span>}
                      {r?.status === "failed" && <span className="text-rose">Failed</span>}
                    </td>
                    <td className="py-3 pr-3">
                      {r?.result && (failedChecks.length === 0
                        ? <span className="text-sage">All passed</span>
                        : <span className="text-rose">{failedChecks.map((c) => c.id).join(", ")}</span>)}
                    </td>
                    {KEYS.map((k) => (
                      <td key={k} className="py-3 pr-3 text-center font-display text-lg tabular-nums">{r?.scores?.[k].score ?? ""}</td>
                    ))}
                    <td className="py-3 text-right">
                      {(r?.result || r?.error) && (
                        <button onClick={() => setOpen(open === s.id ? null : s.id)} className="text-haze underline-offset-2 hover:text-paper hover:underline" aria-expanded={open === s.id}>
                          {open === s.id ? "Hide" : "View"}
                        </button>
                      )}
                      {r?.status === "failed" && !running && (
                        r.failedAt === "judge" && r.rowId ? (
                          <button onClick={() => judge(s.id, r.rowId!)} className="ml-3 text-gold underline-offset-2 hover:underline">Retry scoring</button>
                        ) : (
                          <button onClick={() => runOne(s, runId)} className="ml-3 text-gold underline-offset-2 hover:underline">Retry</button>
                        )
                      )}
                    </td>
                  </tr>
                  {open === s.id && (
                    <tr>
                      <td colSpan={8} className="border-b border-dusk-3 bg-dusk-2/40 px-4 py-6">
                        {r?.error && <p className="mb-4 break-words font-mono text-xs text-rose">{r.error}</p>}
                        {r?.scores && (
                          <dl className="mb-6 grid gap-3 sm:grid-cols-2">
                            {KEYS.map((k) => (
                              <div key={k}>
                                <dt className="text-xs text-haze">{RUBRIC_LABELS[k]}: {r.scores![k].score}/5</dt>
                                <dd className="text-sm">{r.scores![k].reason}</dd>
                              </div>
                            ))}
                            <div className="sm:col-span-2">
                              <dt className="text-xs text-haze">Biggest weakness</dt>
                              <dd className="text-sm text-rose">{r.scores.biggestWeakness}</dd>
                            </div>
                          </dl>
                        )}
                        {r?.result && <PlanView data={{ id: r.rowId ?? null, ...r.result }} placeName={s.name} />}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {finished && scenarios.some((s) => rows[s.id]?.failedAt === "judge") && (
        <button
          onClick={async () => {
            setRunning(true);
            for (const s of scenarios) {
              const r = rows[s.id];
              if (r?.failedAt === "judge" && r.rowId) await judge(s.id, r.rowId);
            }
            setRunning(false);
          }}
          className="mt-6 rounded-xl bg-gold px-5 py-2.5 font-display font-semibold text-dusk hover:bg-[#f7c766]"
        >
          Score the unscored plans
        </button>
      )}

      {finished && (
        <div className="mt-8">
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(markdown());
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            }}
            className="rounded-lg border border-dusk-3 px-4 py-2 text-sm font-medium hover:border-haze"
          >
            {copied ? "Copied" : "Copy results"}
          </button>
          <p className="mt-2 text-sm text-haze">Paste the results into the chat with Claude to record them in the project&apos;s eval log.</p>
        </div>
      )}
    </div>
  );
}

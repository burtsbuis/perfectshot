import { z } from "zod";
import { factsBrief, planForJudge } from "../briefs";
import { runChecks, type CheckResult } from "../checks";
import type { PlanRequest } from "../schema";
import { AgentError, type AgentResult, type Critique } from "./stage1";
import { GraphRunner, type Draft, type Stage2Options } from "./stage2/graph";
import type { Issue, NodeCtx } from "./stage2/nodes";
import { maxWords, structuredCall } from "./structured";

/**
 * STAGE 3: Stage 2's graph plus a critic loop.
 *
 *   Stage 2 pass ─▶ CRITIC (model) ──approve──▶ plan
 *                     │ revise (major issues, each routed to the step that should fix it)
 *                     ▼
 *          re-run ONLY the flagged steps (+ everything downstream of them) ─▶ CRITIC … (max 2 rounds)
 *
 * The critic targets what Stage 2 can't prevent by construction (Run 4): contradictions between
 * sections, light blocked by terrain or buildings at a low sun, safety, ignored requests, and
 * settings that won't work in the chosen light. Failed deterministic checks are added as major
 * issues automatically.
 */
export const MAX_REVIEW_ROUNDS = 2;
const NODES = ["light", "settings", "poses", "writer"] as const;
type NodeName = (typeof NODES)[number];

export const CritiqueSchema = z
  .object({
    verdict: z.enum(["approve", "revise"]),
    issues: z
      .array(
        z.object({
          node: z.enum(NODES).describe("The step that should fix it: light (time, strategy, site), settings (camera), poses, or writer (wording only)."),
          severity: z.enum(["major", "minor"]).describe("major = would mislead or fail a beginner on location; minor = polish."),
          problem: maxWords(30),
          fix: maxWords(30, "A concrete instruction to that step."),
        }),
      )
      .max(6),
  })
  .refine((v) => v.verdict === "approve" || v.issues.some((i) => i.severity === "major"), {
    message: "Only ask for a revision when there is at least one major issue; otherwise approve.",
  });
type CriticOutput = z.infer<typeof CritiqueSchema>;

const CRITIC_SYSTEM = `You review portrait-shoot plans for beginner photographers BEFORE they are shown. Your job is to catch problems that would make the shoot fail or mislead a beginner, and route each one to the step that should fix it.

Look for, in this order:
1. Contradictions: placement vs. the ORIENTATION (who stands where relative to the sun), poses that put people facing the wrong way, tips that fight the settings (e.g. silhouette advice with positive exposure compensation), windows labelled one thing and described as another.
2. Physical plausibility at THIS place: a sun under ~5° blocked by trees, buildings, hills, a far canyon rim or mesa; shade that won't exist at that sun height; light quality claims that the facts contradict.
3. Safety: cliff edges and rims, water, traffic, extreme heat or cold. Plans must keep people safe.
4. Requirements: the photographer's notes and time window must be honored.
5. Settings that won't work in the chosen light for this camera (too dark, ISO beyond its limit, shutter too slow for people).

Route each issue: light = when/strategy/where at the site; settings = camera settings; poses = which poses; writer = wording only (contradictions or unclear text where the underlying decisions are fine).
Use "major" only for problems that would mislead or fail a beginner on location; style nitpicks are "minor" or omitted. If there are no major issues, approve.`;

export async function criticNode(
  ctx: NodeCtx,
  input: { req: PlanRequest; draft: Draft; checks: CheckResult[]; facts: Stage2Options["facts"]; candidates: { id: string; label: string; local: string }[] },
) {
  const { req, draft, checks, facts } = input;
  return structuredCall({
    ...ctx,
    system: CRITIC_SYSTEM,
    user: JSON.stringify({
      request: { place: req.location.name, date: req.date, subjects: req.subjects, notes: req.notes, timeWindow: req.timeWindow, vibe: req.vibe },
      facts: factsBrief(facts),
      camera: { body: facts.gear.body.name, lens: facts.gear.lens.name, maxUsableIso: facts.gear.body.maxUsableIso, eyeAf: facts.gear.body.eyeAf },
      otherAvailableWindows: input.candidates.filter((c) => !draft.chosen.some((w) => w.id === c.id)),
      ORIENTATION: draft.orient.sentence,
      siteNotes: draft.light.siteNotes,
      automatedChecks: checks.map((c) => `${c.status} ${c.id}: ${c.message}`),
      plan: planForJudge(draft.plan, facts.timezone),
    }),
    toolName: "submit_review",
    toolDescription: "Submit your review of the plan.",
    schema: CritiqueSchema,
    maxTokens: 2500,
  });
}

/** Failed deterministic checks become major issues for the step responsible. */
const CHECK_OWNER: Record<string, NodeName> = {
  schema: "writer",
  aperture: "settings",
  iso: "settings",
  settings_consistency: "settings",
  windows: "light",
  sun_direction: "light",
  poses: "poses",
  rain: "writer",
};

function issuesFromChecks(checks: CheckResult[]): Critique["issues"] {
  return checks
    .filter((c) => c.status === "fail")
    .map((c) => ({ node: CHECK_OWNER[c.id] ?? "writer", severity: "major" as const, problem: `Automated check failed (${c.id}): ${c.message}`, fix: "Correct this so the check passes.", source: "check" as const }));
}

/** Re-run only what the issues target, plus everything downstream. */
export async function revise(g: GraphRunner, d: Draft, issues: Critique["issues"], round: number): Promise<Draft> {
  const by = (n: NodeName): Issue[] => issues.filter((i) => i.node === n).map(({ problem, fix }) => ({ problem, fix }));
  const tag = (n: string) => `${n} (revision ${round})`;

  let { light, settings, poses } = d;
  const lightChanged = by("light").length > 0;
  if (lightChanged) light = await g.light(tag("light"), { previous: d.light, issues: by("light") });

  // Settings and poses depend on the light decision: re-run them if light changed or they were flagged
  const redoSettings = lightChanged || by("settings").length > 0;
  const redoPoses = lightChanged || by("poses").length > 0;
  [settings, poses] = await Promise.all([
    redoSettings ? g.settings(light, tag("settings"), by("settings").length ? { previous: d.settings, issues: by("settings") } : undefined) : Promise.resolve(settings),
    redoPoses ? g.poses(light, tag("poses"), by("poses").length ? { previous: d.poses, issues: by("poses") } : undefined) : Promise.resolve(poses),
  ]);

  const orient = lightChanged ? g.orientation(light) : d.orient;
  // The text always gets rewritten: it describes whatever changed, and gets every issue for context
  const text = await g.writer({ light, settings, poses, orient }, tag("writer"), { previous: d.text, issues: issues.map(({ problem, fix }) => ({ problem, fix })) });
  return g.assemble({ light, settings, poses, text, orient });
}

export async function runStage3(req: PlanRequest, opts: Stage2Options): Promise<AgentResult> {
  const g = new GraphRunner(req, opts);
  const critiques: Critique[] = [];
  try {
    let draft = await g.fullPass();
    for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
      const checks = runChecks(draft.plan, req, g.facts);
      const review: CriticOutput = await g.node(
        `critic (round ${round})`,
        () => criticNode(g.ctx, { req, draft, checks, facts: g.facts, candidates: g.candidates }),
        (v) => (v.verdict === "approve" ? "approved" : `${v.issues.filter((i) => i.severity === "major").length} major: ${[...new Set(v.issues.filter((i) => i.severity === "major").map((i) => i.node))].join(", ")}`),
      );
      const issues: Critique["issues"] = [...review.issues.map((i) => ({ ...i, source: "critic" as const })), ...issuesFromChecks(checks)];
      const major = issues.filter((i) => i.severity === "major");
      critiques.push({ round, verdict: major.length ? "revise" : "approve", issues });
      if (!major.length) break;
      draft = await revise(g, draft, major, round);
    }
    return g.result(draft.plan, { critiques });
  } catch (err) {
    throw new AgentError(err instanceof Error ? err.message : String(err), g.trace);
  }
}

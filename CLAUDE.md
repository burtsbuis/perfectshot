# PerfectShot

An AI shoot planner for **beginner photographers**. Given a location, date, camera kit, and subject count, it produces a **Shot Plan**: best time windows, where to position the subject and the photographer relative to the light, starting camera settings, poses, a weather caveat, and a backup plan.

MVP scope: **outdoor natural-light portraits only.** Anything else is out of scope unless `docs/decisions.md` says otherwise.

This is also a **portfolio project** that shows agent design (tool use → graph → critic loop). Code clarity and documented reasoning matter as much as features.

> Also read `AGENTS.md` (Next.js 16 version notes, maintained by `next dev`).

## Stack
- Next.js (App Router) + TypeScript + Tailwind; responsive and installable as a PWA (desktop and mobile share one codebase)
- Anthropic API (`@anthropic-ai/sdk`), **server-side only** (API routes and server actions); never import it in client components
- SunCalc for sun position and golden/blue hour; Open-Meteo for weather (free, no key)
- Supabase for saved plans and auth
- Leaflet + OpenStreetMap for maps (client-only, load with `dynamic(..., { ssr: false })`)
- Zod for every schema; `src/lib/schema.ts` is the single source of truth for the request, facts, and plan shapes

## Core principle: facts in code, judgment in the LLM
- **Code computes:** sun times and azimuth, weather, gear limits, exposure baselines
- **The LLM decides and explains:** light strategy, placement, setting choices within valid ranges, poses, backup plans
- The LLM must **never invent a number that code can compute.** If a plan needs a fact, add a tool or precompute it.
- Every LLM output is validated with Zod and with the rule checks in `src/lib/checks.ts` before it reaches the UI.

## Agent roadmap (build in order; don't skip ahead)
1. ✅ **Stage 1:** a single agent loop with tools (`get_sun_data`, `get_weather`, `get_gear_specs`, `get_pose_library`) → `ShotPlan`
2. ✅ **Stage 2:** an explicit graph: facts → light → [settings ‖ poses] → writer → assemble (ADR-017). `AGENT_STAGE` selects the stage (default 2)
3. **Stage 3:** a critic node that sends the plan back for revision (maximum 2 iterations)
4. **Stage 4 (stretch):** conversational refinement that re-runs only the affected nodes

At each stage: run the evals from the live `/evals` page, record the scores in `docs/eval-results.md`, and add an entry to `docs/decisions.md`.

## Layout
```
src/app/            routes and UI
src/lib/schema.ts   Zod schemas: PlanRequest, ShootFacts, ShotPlan
src/lib/sun.ts      SunCalc wrapper → ShootFacts["sun"]
src/lib/agent/      index.ts (runAgent by stage), stage1.ts + tools.ts, stage2/ (graph.ts, nodes.ts), structured.ts (schema-validated model calls)
src/lib/windows.ts  candidate light windows (Stage 2 picks by id)
src/lib/exposure.ts EV model + feasible exposure options
src/lib/orientation.ts  who stands where, from strategy + sun azimuth
src/lib/timezone.ts offline timezone lookup
src/lib/checks.ts   deterministic plan checks
src/lib/facts.ts    assembles ShootFacts (sun + weather + gear)
data/gear.json      camera bodies and lenses (IDs referenced by PlanRequest)
data/poses.json     pose library, tagged by subject count, vibe, and light
evals/              scenarios.json (the 10 test shoots)
src/lib/evals/      judge.ts (LLM-as-judge rubric), scenarios.ts, auth.ts
src/app/evals/      the /evals scorecard page (runs evals on the live deployment)
supabase/migrations SQL migrations
docs/               spec.md, decisions.md, eval-results.md
```

## Conventions
- TypeScript strict; no `any` unless justified in a comment
- Small, focused modules; pure functions for anything computable, so it's easy to test
- Times: store ISO with timezone; display in the location's local time (not the browser's)
- Secrets only in `.env.local` (see `.env.example`); never commit keys
- Rate limit `/api/plan` (per IP and a global daily cap); the owner pays for API usage
- Commit messages: imperative and scoped, e.g. `agent: add get_weather tool`
- After any non-trivial choice, append an ADR entry to `docs/decisions.md`

## Commands
- `npm run dev`: local dev server
- `npm run lint` / `npm run typecheck` / `npm run build`
- `npm test`: unit tests plus agent-loop tests against a scripted fake model (no API key needed)
- `npm run plan:demo -- <scenarioId> [stage]`: run the real agent on an eval scenario (needs `.env.local`)
- `npm run validate:data`: validate gear, poses, and eval scenarios
- `npm run sun:demo`: print sun facts for a sample location (sanity check for `src/lib/sun.ts`)

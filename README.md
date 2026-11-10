# PerfectShot 📸

**An AI shoot planner for beginner photographers.** Pick a spot, a date, and your camera, and PerfectShot tells you **when to shoot, where to stand, what settings to use, and how to pose your subjects.**

> 🚧 Work in progress. Live demo: https://perfectshot-ruby.vercel.app Built entirely with Claude Code as a portfolio project exploring agent design: tool use → agent graph → critic loop.

## How it works
PerfectShot separates **facts** from **judgment**:

| Facts (deterministic code) | Judgment (Claude) |
|---|---|
| Sun position, golden/blue hour (SunCalc) | Light strategy: backlight, side light, open shade |
| Hourly weather (Open-Meteo) | Where to put the subject and the photographer |
| Lens and body limits (`data/gear.json`) | Settings within those limits, and why |
| Pose library (`data/poses.json`) | Picking and adapting poses for the scene |

Every plan is validated against a schema and rule-checked against the facts (for example, the agent can't suggest f/1.8 on an f/4 lens).

## Agent roadmap
- [x] **Stage 1:** single agent with tools ([`stage1.ts`](src/lib/agent/stage1.ts)); evals pending
- [x] **Stage 2:** explicit agent graph with parallel branches ([`stage2/graph.ts`](src/lib/agent/stage2/graph.ts))
- [ ] **Stage 3:** critic and revision loop
- [ ] **Stage 4:** conversational refinement

Each stage is scored on the `/evals` page (10 test shoots × 7 fact checks + an AI judge). Scores are in [`docs/eval-results.md`](docs/eval-results.md); design decisions are in [`docs/decisions.md`](docs/decisions.md).

## Stage 2 architecture

```
facts (code) ─▶ windows + exposure (code) ─▶ LIGHT (Claude)
                                               │
                                ┌──────────────┴──────────────┐
                                ▼                             ▼
                        SETTINGS (Claude)               POSES (Claude)     ← parallel
                                └──────────────┬──────────────┘
                                               ▼
                      orientation (code) ─▶ WRITER (Claude) ─▶ assemble (code) ─▶ Shot Plan
```
Claude chooses windows and poses **by id** from lists built by code. Every number in the final plan (times, sun direction, gear limits) comes from code. Each step's rules are enforced by its schema, and violations go back to Claude with the reason.

## Stack
Next.js · TypeScript · Tailwind · Anthropic API · Supabase · SunCalc · Open-Meteo · Leaflet/OSM · Vercel

## Getting started
```bash
npm install
cp .env.example .env.local   # add your keys
npm run dev
npm test                     # unit + agent-loop tests (no API key needed)
npm run plan:demo -- 1       # run the agent on eval scenario #1
```
Apply the database schema: run `supabase/migrations/0001_plans.sql` in the Supabase SQL editor (or `supabase db push`).

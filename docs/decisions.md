# Decision Log

Lightweight ADRs. Append new entries at the bottom: **context → decision → why → consequences**.

---

## ADR-001: Target user and MVP scope
_2026-11-09_
- **Context:** Existing apps split light planning (PhotoPills), settings (CamSet), and posing (Atlegras) across separate tools, and most react to the live scene rather than planning ahead.
- **Decision:** v1 serves beginners with an entry-level mirrorless/DSLR camera, for **outdoor natural-light portraits** only.
- **Why:** Portraits use all three pillars (light, settings, poses), so the agent has real reasoning to do. Dedicated cameras make settings advice concrete and checkable.
- **Consequences:** Landscape, astro, phone-only, and flash are out of scope until v1 ships.

## ADR-002: Facts in code, judgment in the LLM
_2026-11-09_
- **Decision:** Sun position, golden/blue hour, weather, and gear limits come from deterministic code and APIs. Claude only reasons over those facts.
- **Why:** LLMs are unreliable at astronomy and arithmetic. Deterministic facts are testable and make the evals meaningful.
- **Consequences:** Every fact the plan needs must exist as a tool or a precomputed input. Plans are rule-checked against the facts.

## ADR-003: Stack: Next.js PWA + Supabase
_2026-11-09_
- **Decision:** Next.js (App Router, TS, Tailwind) delivered as a PWA. Supabase for saved plans and auth. Open-Meteo for weather. Leaflet/OSM for maps. Hosted on Vercel.
- **Why:** One codebase covers desktop and mobile. API routes keep the Anthropic key server-side. Free data sources with no keys.
- **Consequences:** No native app features (background location, AR) in v1.

## ADR-004: Demo cost model
_2026-11-09_
- **Decision:** The owner pays for API usage on the public demo, with per-IP and global daily rate limits plus a spend cap in the Anthropic Console.
- **Why:** Portfolio reviewers shouldn't have to bring their own API key.

## ADR-005: SunCalc v2 semantics
_2026-11-09_
- **Context:** `suncalc@2` changed units from v1: azimuth is now **degrees clockwise from north**, altitude is in **degrees** (refraction-corrected), and events that don't occur return `null`. The first implementation assumed v1 radians and produced impossible altitudes (117°).
- **Decision:** Use v2 values directly. Drop `@types/suncalc` (v1 types); v2 ships its own.
- **Consequences:** Polar day and night are handled as `null` windows. Verified: Baker Beach on Nov 20 sets at 243° WSW, 4:55 PM PT.

## ADR-006: Agent built in four stages
_2026-11-09_
- **Decision:** Stage 1 tool-using agent → Stage 2 explicit graph → Stage 3 critic loop → Stage 4 conversational refinement. Evals are re-run at every stage.
- **Why:** Each stage adds complexity only when the evals show it's needed. The progression itself is the portfolio story.

## ADR-007: Stage 1 agent design
_2026-11-09_
- **Context:** Stage 1 is the baseline that later stages are measured against. It should be the simplest agent that works.
- **Decision:**
  - A single tool-use loop (`src/lib/agent/stage1.ts`) with 4 fact tools plus a terminal **`submit_plan`** tool whose input schema is generated from `ShotPlanSchema` (`z.toJSONSchema`). The plan arrives as structured tool input, not prose that has to be parsed.
  - Tool calls in one turn run **in parallel**. Tool errors go back to the model as `is_error` results rather than crashing the run.
  - The loop retries **only on schema errors** (max 2). Rule checks (`checks.ts`) run *after* the loop and are reported, not acted on. Acting on them is Stage 3's job, so the evals can show what a critic loop adds.
  - Hard caps: 8 turns, 8k output tokens per turn.
  - The model is injected as a `create` function, so the loop is unit-tested against a **scripted fake model**: deterministic, free, and no API key.
- **Consequences:** A Stage 1 plan can fail rule checks; the API returns them alongside the plan. Facts are fetched twice (once by the tools, once for the checks); that's acceptable at 2 Open-Meteo calls per plan.

## ADR-008: Rate limiting via read-then-upsert
_2026-11-09_
- **Decision:** `plan_usage` counters, keyed by `global` and a salted SHA-256 of the IP. Read-then-upsert isn't atomic.
- **Why:** No extra SQL function to deploy. The worst case is a few extra plans over the limit during a burst, which is fine for a demo. The fix is a Postgres function using `insert … on conflict do update … returning`.

## ADR-009: Zoom apertures and pose verification
_2026-11-09_
- **Decision:** Added `settings.focalLengthMm` (required for zooms) and `poses[].libraryId` to `ShotPlan`. Variable-aperture zooms are linearly interpolated and rounded up.
- **Why:** Without a focal length, "f/4.5 on an 18–45mm f/4.5–6.3" can't be judged right or wrong. With `libraryId`, the checks can verify pose suitability instead of guessing from free text.

## ADR-010: Supabase's new API keys
_2026-11-09_
- **Context:** Supabase is retiring its legacy `anon` and `service_role` keys in early 2027 in favor of **publishable** (`sb_publishable_…`) and **secret** (`sb_secret_…`) keys.
- **Decision:** Use the new keys from the start: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
- **Why:** No forced migration later. Secret keys can also be rotated individually and are refused if they're used in a browser.

## ADR-011: Planner UI and the sun compass
_2026-11-09_
- **Decision:** A single page: a form (map pin or OSM search, date, subjects, camera and lens filtered by mount, optional vibe and notes) and the plan beside it on desktop or below it on mobile. The plan leads with the best time window and a **sun compass**, a top-down SVG showing the sun's real azimuth, the subject at the center, and the camera placed by the light strategy (backlight → opposite the sun, side light → 90°).
- **Why:** Light direction is the hardest thing for beginners to picture, and a diagram beats a sentence like "the sun at 243° WSW". The compass is pure geometry from the plan, so it adds no new facts.
- **Also:** A "How this plan was made" panel shows the rule checks and the agent's steps, which keeps the agent design visible to portfolio reviewers. Palette: blue-hour indigo for the interface, golden-hour amber reserved for the light.

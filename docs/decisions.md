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

## ADR-012: Failures must explain themselves
_2026-11-09_
- **Context:** The first live run failed with a generic "Couldn't generate a plan." Diagnosing it took three deploys: the real cause (a 401 from a mis-pasted API key) was hidden, and a format check I added (`sk-ant-api` prefix) then blocked a valid key.
- **Decision:** API failures return a friendly message **plus** a technical detail line that the UI shows under "Technical details". Rejected keys report only a non-secret type label and length, with hints for common mix-ups. Keys are cleaned of quotes and whitespace but never rejected by format; Anthropic is the authority on validity.
- **Lesson:** Validate what you control, and defer to the source of truth for what you don't. Every failure path should say what to change.

## ADR-013: Evals run on the live deployment, from a password-protected page
_2026-11-10_
- **Context:** The API key lives only in Vercel and the owner works in the browser, so a local eval script isn't practical.
- **Decision:** `/evals` page plus two endpoints. `POST /api/evals/plan` runs the agent on one scenario, applies the checks, and stores a row in `eval_runs`. `POST /api/evals/judge` scores that stored row with an LLM judge. The page runs scenarios one at a time and offers "Copy results" as markdown for `docs/eval-results.md`.
- **Why one scenario per request:** It stays well under the hosting time limit, shows progress live, and makes a single failure retryable.
- **Judge design:** It uses the same model as the agent by default (`EVAL_JUDGE_MODEL` overrides) and is forced to answer through a `submit_scores` tool (1–5 per rubric item, a reason, and the biggest weakness). It sees the same facts and check results as the agent. **Known bias:** a model judging its own family's output may be lenient, so the deterministic checks remain the hard signal and judge scores are read as relative (stage vs. stage), not absolute.
- **Clarity includes concision** in the rubric, so the "word wall" feedback becomes a measurable number before the redesign.
- **Caveat:** Scenarios with dates within ~16 days get a live forecast, so runs on different days aren't perfectly identical. Compare stages from runs made close together.

## ADR-014: Don't force tool use in the judge
_2026-11-10_
- **Context:** The first live eval run failed at scoring with `tool_choice: type "tool" and "any" are not supported for this model`. Plans were generated and checked fine.
- **Decision:** The judge offers `submit_scores` with `tool_choice` left at its default and is instructed to call it. If it answers in prose, it gets one nudge. The eval page retries **only the failed step**: "Retry scoring" / "Score the unscored plans" re-judge stored plans without regenerating them.
- **Lesson:** API capabilities vary by model. Depend on the lowest common denominator and recover gracefully. And make retries cheap: never redo expensive work that already succeeded.

## ADR-015: Fix the measuring stick before comparing stages
_2026-11-10_
- **Context:** The first full eval run (Run 0) surfaced two problems in **our** facts and tooling, not the agent: (1) blue hour was defined as −6° to −12°, which is too late and dark; the judge rightly flagged Reykjavík's blue hour as mis-timed. (2) The judge's fact summary omitted temperature, wind, and stabilization, so it wrongly accused a plan of inventing wind data.
- **Decision:** Blue hour = civil twilight (0° to −6°). The judge sees the same weather fields and stabilization facts as the agent. Added check #8 (no exposure compensation in manual with a fixed ISO; allowed with Auto ISO). Run 0 is recorded but marked pre-fix; the **corrected Stage 1 baseline** is re-run before any agent change.
- **Why:** If the scorecard changes at the same time as the agent, you can't tell which one moved the score. Evaluate the evaluator first.

## ADR-016: Timezone is computed offline
_2026-11-10_
- **Context:** The timezone came from the Open-Meteo response. When that call failed, it fell back to UTC and every time on the page was hours off (found in an end-to-end test where the weather service was unreachable).
- **Decision:** `@photostructure/tz-lookup` resolves the IANA timezone from coordinates offline. Weather is now optional enrichment; times never depend on it.
- **Also:** `lowSunAllDay`: when the sun rises but never passes ~6° (Reykjavík at the solstice peaks at 2.7°), there's no golden-hour event, but all of daylight is golden-quality. The windows check accepts sunrise–sunset on those days. This is a scorecard fix, so it applies to both stages.

## ADR-017: Stage 2, an explicit graph that constrains by construction
_2026-11-10_
- **Context:** The Stage 1 baseline (Run 1) failed in four ways: misquoted numbers, self-contradictions, unrealistic exposure, and text too long (clarity flat at 3).
- **Decision:** Replace the open tool loop with a fixed graph (`src/lib/agent/stage2/`):
  `facts (code) → windows + exposure (code) → light (model) → [settings ‖ poses] (model, parallel) → orientation (code) → writer (model) → assemble (code)`.
  - **Choose, don't type:** time windows and poses are offered as **enums of ids** built by code. The model can't invent a time or a pose.
  - **Decide once:** the light node fixes the strategy; the settings, poses, and writer nodes receive it.
  - **Geometry in code:** sun direction and who stands where (`orientation.ts`) come from code, the same geometry as the compass diagram.
  - **Exposure model:** `exposure.ts` estimates subject brightness (EV) from sun altitude, cloud, and strategy. The settings node gets a table of feasible aperture/shutter/ISO combinations, and its schema rejects ones the camera can't reach.
  - **Rules as schemas:** each node's Zod schema carries domain refinements (aperture limits, ISO ceiling, exposure compensation in manual, word limits). A violation goes back to the model as a tool error (`structured.ts`), up to 3 tries.
  - **Writer with word limits** (summary ≤ 40 words, placements ≤ 30, and so on) aimed at the clarity score.
- **Trade-offs:** 4+ model calls instead of ~3 turns, but each is small and focused, and two run in parallel. Less freedom: the model can't propose a time outside the candidates (e.g. "11:30, when the canopy shades the path"); `late_afternoon` and `your_window` exist to cover the common cases. Terrain knowledge is still missing (no data source yet).
- **Honest caveat for the evals:** Stage 2 passes several checks *by construction* (windows, sun direction, aperture), so check pass rates measure the architecture as much as the model. The judge scores (light reasoning, clarity) are where the comparison is meaningful.
- **Both stages stay runnable:** `AGENT_STAGE` (default 2) picks the stage for the site; the /evals page has a Stage 1 / Stage 2 picker.

## ADR-018: Show constraints up front, and enforce them with slack
_2026-11-10_
- **Context:** The first live Stage 2 run failed: the writer exceeded the 30-word limit on `settingsWhy` three times in a row. The limits lived only in Zod refinements, which don't appear in the JSON schema the model sees, so the model learned about each limit only from the rejection, without a word count.
- **Decision:** `maxWords(n, hint?)` puts "At most N words." in the field's schema description (combined with any hint), tolerates a 25% overrun, and rejects with the actual count ("This is 41 words; the limit is 30"). A test asserts that every described string field in the light and writer schemas states its limit.
- **Lesson:** Validation that only speaks after failure turns into a guessing game. Tell the model the rules before it writes; keep strict enforcement for real violations.

## ADR-019: Merge split answers; daylight windows require open shade
_2026-11-10_
- **Context:** (1) The judge answered with four parallel `submit_scores` calls (one per criterion). The retry replied to only one, and the API rejected the conversation ("tool_use ids were found without tool_result blocks"). (2) The Stage 2 light node picked `late_afternoon`, plain daylight, without shade, failing the windows check. The rule existed only in the check, not in what the model was told.
- **Decision:** `structuredCall` merges multiple submit calls in one reply and, when asking for a fix, returns a `tool_result` for **every** `tool_use`. The judge now uses `structuredCall`, so there's one hardened implementation instead of two. Daylight candidates (`late_afternoon`, `your_window`) require `openShade: true` in the light schema, and the assembled label says "…, in open shade".
- **Lesson:** Product rules belong where decisions are made, not only in after-the-fact checks. And a duplicated helper drifts: shared code means each fix lands everywhere.

## ADR-020: The judge grades what the user sees; past runs can be re-scored
_2026-11-10_
- **Context:** Stage 2's first run passed 10/10 checks but scored *lower* on usefulness (3.5 → 2.8) and specificity (3.5 → 2.9). Reading the judge's reasons showed part of the drop was measurement: (1) the judge read stored ISO UTC times and complained beginners get "UTC timestamps", though the page shows local times. Stage 1 happened to restate local times in its labels, Stage 2's tighter text didn't. (2) In aperture priority the shutter value is a *minimum*, but it read as a fixed setting ("contradictory settings" in 6/10).
- **Decision:** The judge sees `planForJudge`: local times as shown, plus what the shutter value means in that mode. Stage 2 writes aperture-priority shutters as "1/250 or faster", and the UI labels it "Slowest shutter". Real gaps fixed in the light node: photographer notes are requirements; low all-day sun is used as directional light; likely overcast is planned for.
- **Re-scoring:** `GET /api/evals/runs` and the "Past runs" panel load stored plans and re-judge them with the current judge, so Stage 1 and Stage 2 are compared under the **same** judge without regenerating plans.
- **Lesson:** When a change looks like a regression, read the evidence before concluding. Some of it was the ruler, not the work.

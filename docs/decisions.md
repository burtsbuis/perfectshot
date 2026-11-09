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

# Spec

The data contracts live in code: **`src/lib/schema.ts`** (`PlanRequest`, `ShootFacts`, `ShotPlan`). This doc covers what code can't express.

## User flow (MVP)
1. Pick a location (map pin or search) and a date. Optionally set a time window, vibe, and notes.
2. Pick a camera body and lens (from `data/gear.json`) and the number of subjects (1, 2, 3, or 4+).
3. **Generate plan** → the agent returns a `ShotPlan`, rendered as cards: Timing · Light & placement · Settings · Poses · Weather & backup · Checklist.
4. Save the plan to your account (Supabase). Saved plans are listed on `/plans`.

## Automated plan checks (run on every agent output)
1. Validates against `ShotPlanSchema`
2. `settings.aperture` ≥ the lens's widest aperture (for zooms, use the aperture at the chosen focal length, conservatively the tele end)
3. A numeric `settings.iso` ≤ `body.maxUsableIso`
4. Each recommended window overlaps a computed sun window, or its label says open shade/overcast
5. `lighting.sunDirectionAtBestTime.azimuthDeg` is within ±10° of the SunCalc azimuth at that window's midpoint
6. 3–5 poses, and they suit the subject count
7. Max precipitation probability > 50% → `weatherCaveat` mentions rain and `backupPlan` isn't empty

## LLM-as-judge rubric (1–5 each)
- **Usefulness:** could a beginner act on this plan without looking anything up?
- **Light reasoning:** do placement and strategy make sense given the sun direction and weather?
- **Clarity:** is it jargon-free, or is the jargon explained?
- **Specificity:** does it use this location and these conditions, or is it generic?

Scenarios: `evals/scenarios.json`. Results per agent stage: `docs/eval-results.md`.

# Eval Results

One row per run, made from the **/evals** page ("Copy results"). Rule-check pass = scenarios passing all fact checks (7 checks before ADR-015, 8 after) / scenarios completed. Judge scores are averages (1–5): Useful, Light reasoning, Clarity (includes concision), Specificity.

Judge scores are best read **relative** (stage vs. stage, same judge model), not as absolute quality. See ADR-013.

| Date | Agent stage | Model | Rule-check pass | Useful | Light | Clarity | Specific | Avg latency | Avg tokens | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-10 | 1 | claude-sonnet-5-5 | 6/10 | 3.5 | 3.1 | 3.0 | 3.8 | 33.0s | 14,781 | **Run 0 (pre-fix).** 7 checks, old blue-hour definition, judge missing temp/wind/stabilization facts. #8 needed one retry. Superseded by the corrected baseline below. |

## Per-scenario detail

_Added below each run._

### Run 0: 2026-11-10 19:59 UTC · Stage 1 · pre-fix (see ADR-015)

| # | Scenario | Checks | Useful | Light | Clarity | Specific | Biggest weakness (judge) |
|---|---|---|---|---|---|---|---|
| 1 | Baker Beach sunset couple | ✓ all | 4 | 4 | 3 | 4 | Cites wind/temperature "the planner wasn't given" (**judge error**: it was; the judge's brief omitted them). Shutter "1/250 or faster" conflicts with aperture priority. |
| 2 | Bethesda Terrace slow kit lens | ✓ all | 4 | 4 | 3 | 4 | Jargon-heavy settings; 1/250 s unrealistic in dim light at f/5.5. |
| 3 | Joshua Tree summer midday | ✓ all | 4 | 3 | 3 | 4 | Ranks the overhead-sun window first; ignores how little boulder shade exists at midday. |
| 4 | Kerry Park December trio | ✓ all | 3 | 3 | 3 | 4 | Relies on 2–4° backlight in likely overcast; +0.7 EV in full manual (contradiction). |
| 5 | Golden Gate Park forest | ✗ windows | 3 | 2 | 3 | 3 | Calls 5:09–6:39 PM golden hour (it starts 7:07 PM); contradictory backlight vs. front-light advice. |
| 6 | Santa Monica Pier summer group | ✗ windows | 4 | 3 | 3 | 4 | Barely addresses crowds; treats 24mm on APS-C (~38mm equiv.) as very wide. |
| 7 | Chicago Riverwalk winter | ✗ windows | 3 | 3 | 3 | 4 | Calls direct 9–17° morning sun "soft"; skips the 7:15 AM golden hour; buildings may block the rank-1 window. |
| 8 | Reykjavík solstice | ✗ windows | 3 | 3 | 3 | 4 | Blue hour 16:48–17:57 "mis-timed" (**fact error**: our blue hour used −6° to −12°); 1/200 s floor + ISO 6400 cap underexposes. |
| 9 | Horseshoe Bend couple | ✓ all | 3 | 2 | 3 | 3 | Ignores canyon shadow at 2° sun; window starts outside golden hour. |
| 10 | South Pointe sunrise | ✓ all | 4 | 4 | 3 | 4 | Calls dim sunrise "bright"; says 1/250 s needed for no stabilization though the X-S20 has IBIS; wordy. |

**Patterns (Stage 1 weaknesses to target):**
1. **Settings coherence:** mode/shutter/ISO/compensation contradict each other, and body stabilization is ignored (#1, #2, #4, #8, #10). → New check #8; a settings specialist in Stage 2.
2. **Window discipline:** 4/10 recommend times outside real light windows or mislabel light quality (#5–#8). → Light specialist + critic.
3. **Terrain blindness:** canyon, building, and boulder shadows are ignored (#3, #7, #9). No terrain facts exist yet: a known gap.
4. **Clarity is flat at 3/10 across the board:** the "word wall". → Presentation + writing pass.


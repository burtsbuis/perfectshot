# Eval Results

One row per run, made from the **/evals** page ("Copy results"). Rule-check pass = scenarios passing all fact checks (7 checks before ADR-015, 8 after) / scenarios completed. Judge scores are averages (1–5): Useful, Light reasoning, Clarity (includes concision), Specificity.

Judge scores are best read **relative** (stage vs. stage, same judge model), not as absolute quality. See ADR-013.

| Date | Agent stage | Model | Rule-check pass | Useful | Light | Clarity | Specific | Avg latency | Avg tokens | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-10 | 1 | claude-sonnet-5-5 | 6/10 | 3.5 | 3.1 | 3.0 | 3.8 | 33.0s | 14,781 | **Run 0 (pre-fix).** 7 checks, old blue-hour definition, judge missing temp/wind/stabilization facts. #8 needed one retry. Superseded by the corrected baseline below. |
| 2026-11-10 | 1 | claude-sonnet-5-5 | **7/10** | **3.5** | **2.8** | **3.0** | **3.5** | 32.8s | 14,680 | **Run 1: official Stage 1 baseline.** 8 checks, corrected facts and judge. |
| 2026-11-10 | 2 | claude-sonnet-5-5 | 10/10 | 2.8 | 3.0 | 3.0 | 2.9 | 25.4s | 10,467 | **Run 2: Stage 2 first run** (judge v2: sees raw UTC times; to be re-scored with judge v3) |
| 2026-11-10 | 1 | claude-sonnet-5-5 | 7/10 | 3.2 | 2.9 | 3.0 | 3.6 | 32.8s | 14,680 | **Run 1 re-scored with judge v3** (same plans as Run 1). #10 needed one re-score. |
| 2026-11-11 | 2 | claude-sonnet-5-5 | 10/10 | 2.9 | 2.7 | 3.2 | 2.8 | 29.5s | 11,788 | **Run 3: Stage 2 with ADR-020 fixes, judge v3** |
| 2026-11-24 | 2.1 | claude-sonnet-5-5 | 10/10 | 3.0 | 2.7 | 3.1 | **3.4** | 26.6s | 11,184 | **Run 4: Stage 2.1** (ADR-021), judge v3 + lowSunAllDay |
| 2026-11-24 | 2.2 | claude-sonnet-5-5 | 10/10 | 3.0 | 2.6 | 3.2 | 3.4 | 25.2s | 11,526 | **Run 6: Stage 2 + exposure recalibration** (ADR-022) |
| 2026-11-24 | 3 | claude-sonnet-5-5 | 10/10 | 3.1 | 2.9 | 3.2 | 3.2 | 87.4s | 44,214 | **Run 5: Stage 3 critic loop** (ADR-023) |

## Per-scenario detail

_Added below each run._

### Stage 2 vs Stage 3 (same day, same judge, same facts)

| | Checks | Useful | Light | Clarity | Specific | Time | Tokens |
|---|---|---|---|---|---|---|---|
| Stage 2 (Run 6) | 10/10 | 3.0 | 2.6 | 3.2 | **3.4** | **25.2s** | **11.5k** |
| Stage 3 (Run 5) | 10/10 | **3.1** | **2.9** | 3.2 | 3.2 | 87.4s | 44.2k |

**Verdict: the critic isn't worth its cost yet.** Light reasoning improved by +0.3 (at the edge of noise), usefulness by +0.1 (noise), and specificity fell by 0.2 (noise). That's for **3.5× the time and 3.8× the tokens**. Stage 2 stays the default on the site.

Why the critic didn't help more, from the notes:
- **It can't fix what no step knows:** terrain (canyon rim, church, river corridor, trees), crowds. The critic flags them, but the light step has no data to act on.
- **It inherits the facts' blind spots:** the blue-hour notes still read as too optimistic in both stages (#1, #2, #9, #10 in Stage 3). Code-computed notes aren't reviewable by re-running a model step.
- **Product rule vs. judge:** both stages put the user's 11:00–14:00 Joshua Tree window first (our rule, ADR-021); the judge wants the shoot steered to golden hour for heat safety. This is a product decision, not an agent bug.

**Blue-hour root cause (code):** `settingsNoteFor` evaluates exposure at the window's *midpoint* (sun ≈ −3°). Blue hour darkens ~3 stops from start to end (EV ≈ 10 → 3), so "same settings, ISO ~1600" is true early and badly wrong late. Fix: report the range across the window.

### Run 6: 2026-11-24 20:19 UTC · Stage 2 (+ ADR-022 recalibration)

| # | Scenario | Checks | U | L | C | S | Biggest weakness (judge) |
|---|---|---|---|---|---|---|---|
| 1 | Baker Beach | ✓ | 3 | 3 | 3 | 4 | Blue-hour "same settings, ISO ~1600" wrong at f/2.8, 1/160. |
| 2 | Bethesda Terrace | ✓ | 3 | 3 | 3 | 4 | 3.8° sun must clear trees and skyline; blue-hour claim dubious at f/5.5. |
| 3 | Joshua Tree | ✓ | 3 | 2 | 3 | 3 | Midday shade first despite extreme July heat. |
| 4 | Kerry Park | ✓ | 3 | 2 | 3 | 4 | Overcast blue hour first with f/4, 1/250 underexposes; facing contradicts framing. |
| 5 | Golden Gate Park | ✓ | 3 | 3 | 3 | 3 | Little help with dappled light; facing direction vs. low west sun unclear. |
| 6 | Santa Monica Pier | ✓ | 3 | 3 | 3 | 3 | Ignores crowds; Cloudy WB with backlight; 6 PM "open shade". |
| 7 | Chicago Riverwalk | ✓ | 3 | 2 | 3 | 3 | Ignores the east–west river corridor; optimistic blue hour; AF-S for walking. |
| 8 | Reykjavík | ✓ | 3 | 3 | 4 | 4 | South sun likely blocked by the church; implausible ISOs; blue-hour backdrop faces away from the glow. |
| 9 | Horseshoe Bend | ✓ | 3 | 2 | 4 | 3 | 2° sun first without admitting rim shade; blue-hour exposure unrealistic. |
| 10 | South Pointe | ✓ | 3 | 3 | 3 | 3 | Sunrise backlight setup applied to all windows, incl. evening. |

### Run 5: 2026-11-24 20:01 UTC · Stage 3 (critic loop)

| # | Scenario | Checks | U | L | C | S | Biggest weakness (judge) |
|---|---|---|---|---|---|---|---|
| 1 | Baker Beach | ✓ | 4 | 4 | 3 | 4 | Jargon in settings (Auto ISO minimum shutter, EV) without camera menu steps. |
| 2 | Bethesda Terrace | ✓ | 3 | 3 | 3 | 4 | Confusing facing wording; 1/160 minimum vs 1/125 blue-hour note. |
| 3 | Joshua Tree | ✓ | 3 | 3 | 3 | 3 | 11–2 PM first despite dangerous heat; no way to find shade at high sun. |
| 4 | Kerry Park | ✓ | 3 | 2 | 3 | 3 | Arbitrary pre-golden window ranked "brightest"; sun-direction effects under 100% cloud. |
| 5 | Golden Gate Park | ✓ | 3 | 2 | 4 | 3 | Window unexplained; no help with dappled light or the grove edge. |
| 6 | Santa Monica Pier | ✓ | 3 | 3 | 3 | 3 | Ignores crowds; blue-hour and backup advice contradict the setup. |
| 7 | Chicago Riverwalk | ✓ | 3 | 3 | 3 | 3 | City lights "behind them" at 2:31–4:01 PM (not lit yet); optimistic blue hour. |
| 8 | Reykjavík | ✓ | 3 | 2 | 3 | 3 | Ranks post-sunset blue hour first (ISO 3200–6400) instead of the all-day low sun. |
| 9 | Horseshoe Bend | ✓ | 3 | 3 | 4 | 3 | Shooting west puts the rim behind them, contradicting its own safety claim; blue-hour ISO. |
| 10 | South Pointe | ✓ | 3 | 4 | 3 | 3 | Blue-hour "same settings, ISO ~1600" too optimistic. |

### Run 4: 2026-11-24 19:05 UTC · Stage 2.1 (ADR-021)

| # | Scenario | Checks | Useful | Light | Clarity | Specific | Biggest weakness (judge) |
|---|---|---|---|---|---|---|---|
| 1 | Baker Beach sunset couple | ✓ all | 3 | 3 | 3 | 3 | Blue-hour note "same settings, ISO ~400" is far too optimistic (**exposure model too bright**); +0.7 conflicts with silhouette advice. |
| 2 | Bethesda Terrace slow kit lens | ✓ all | 3 | 3 | 3 | 4 | ~4° sun likely hidden by trees; blue-hour "same settings" at f/6.3 would exceed ISO 6400; pose contradicts placement. |
| 3 | Joshua Tree summer midday | ✓ all | 3 | 3 | 3 | 3 | Ranks 11–2 open shade first in July desert heat without heat safety or which side of a boulder is shaded. |
| 4 | Kerry Park December trio | ✓ all | 3 | 2 | 3 | 3 | Overcast blue hour first with f/4 and 1/250 floor underexposes; facing directions contradict. |
| 5 | Golden Gate Park forest | ✓ all | 3 | 2 | 3 | 3 | Says the sun is high and expects bright, low-ISO shade; the sun is low and the shade dim. |
| 6 | Santa Monica Pier summer group | ✓ all | 3 | 3 | 3 | 4 | f/4 at 1/250 can't give ISO 1600 at blue hour; conflicts with jump and silhouette tips. |
| 7 | Chicago Riverwalk winter | ✓ all | 3 | 3 | 3 | 4 | Blue-hour ISO estimate optimistic for a 3200-ISO body; no Auto ISO maximum advice. |
| 8 | Reykjavík solstice | ✓ all | 3 | 3 | 4 | 3 | One 4-hour window with a fixed setup; no best time (~1:30 PM, sun south) or placement change as the sun moves. |
| 9 | Horseshoe Bend couple | ✓ all | 3 | 2 | 3 | 3 | Doesn't admit a 2° sun is likely blocked by the far mesa; "slide along the rim" (safety). |
| 10 | South Pointe sunrise | ✓ all | 3 | 3 | 3 | 4 | Pre-sunrise blue-hour settings far too optimistic; evening front light unexplained. |

**Stage 2.1 vs Stage 2:** specificity recovered (2.8 → 3.4); usefulness 2.9 → 3.0; clarity 3.2 → 3.1, light 2.7 → 2.7 (noise). Checks stay 10/10.

**New dominant failure: the exposure model is too bright at low sun and in twilight.** Five of ten "biggest weaknesses" (#1, #2, #6, #7, #10) cite the code-computed blue-hour note ("same settings, ISO ~400"). The judge is right: real-world portraits at mid blue hour typically need roughly ISO 1600–3200 at f/2.8 and 1/160, about 2 stops darker than the model assumed. A good illustration of "facts in code" cutting both ways: a confident wrong fact gets repeated everywhere. → Recalibrated in ADR-022.

**Remaining patterns → Stage 3 (critic):** internal contradictions (facing directions, poses vs placement, silhouette vs exposure compensation), terrain blockage at low sun, safety (heat, cliff rims).

### Fair comparison under judge v3 (Run 1 re-scored vs. Run 3)

| | Checks | Useful | Light | Clarity | Specific | Time | Tokens |
|---|---|---|---|---|---|---|---|
| Stage 1 | 7/10 | **3.2** | **2.9** | 3.0 | **3.6** | 32.8s | 14,680 |
| Stage 2 | **10/10** | 2.9 | 2.7 | **3.2** | 2.8 | **29.5s** | **11,788** |

**Reading it honestly:** Stage 2 wins on mechanical correctness (no invented times, gear violations, or contradictory windows), cost, and slightly on clarity. Light is within noise. **Specificity dropped by 0.8, more than noise**: constraining the model and capping word counts squeezed out location detail. Stage 2 traded richness for reliability.

### Run 3: 2026-11-11 00:26 UTC · Stage 2 (ADR-020 fixes) · judge v3

| # | Scenario | Checks | Useful | Light | Clarity | Specific | Biggest weakness (judge) |
|---|---|---|---|---|---|---|---|
| 1 | Baker Beach sunset couple | ✓ all | 3 | 4 | 3 | 3 | One f/4, 1/160 setup can't cover blue hour; silhouette tip contradicts +0.7 compensation. |
| 2 | Bethesda Terrace slow kit lens | ✓ all | 3 | 3 | 3 | 3 | Assumes the lake and the low WSW sun line up; trees and buildings likely block a 3.8° sun. |
| 3 | Joshua Tree summer midday | ✓ all | 3 | 3 | 4 | 3 | Built around sunrise; the user's 11:00–14:00 open-shade window gets no tailored guidance. |
| 4 | Kerry Park December trio | ✓ all | 3 | 3 | 3 | 3 | Assumes clear low sun; the overcast fallback keeps settings that would badly underexpose. |
| 5 | Golden Gate Park forest | ✓ all | 3 | 2 | 3 | 3 | Backlight through trees ignores that canopy blocks a 3° sun; no dappled-light handling. |
| 6 | Santa Monica Pier summer group | ✓ all | 3 | 3 | 3 | 3 | One setup for blue hour and jumps; "tap a face on your phone" is wrong for an R10. |
| 7 | Chicago Riverwalk winter | ✓ all | 3 | 2 | 3 | 2 | Eye AF on a body without it; no ISO cap; muddled shade logic at 4° sun. |
| 8 | Reykjavík solstice | ✓ all | 2 | 1 | 3 | 2 | "Warm all-day window" with no golden hour (**judge gap**: judge facts omit `lowSunAllDay`); facing directions don't match. |
| 9 | Horseshoe Bend couple | ✓ all | 3 | 3 | 4 | 3 | No canyon-shadow handling at 2° sun. |
| 10 | South Pointe sunrise | ✓ all | 3 | 3 | 3 | 3 | A pose mentions the *setting* sun at sunrise (**data bug**: pose library text is sunset-specific); phone tip. |

**Stage 2 failure patterns → fixes:**
1. **One set of settings for several windows** (#1, #4, #6): code can compute per-window exposure adjustments.
2. **Writer doesn't know the camera** (#6, #7, #10: phone tips, eye AF on a body without it): pass gear features to the writer.
3. **Pose library wording is sunset-specific** (#10): neutral data.
4. **User's time window not made primary** (#3): if the photographer gives a window, plan the main shoot in it.
5. **Low sun + obstacles** (#2, #5, #9; Stage 1 too): no terrain data. A critic (Stage 3) can at least catch the reasoning gaps.
6. **Specificity**: loosen writer limits and require concrete site features in placements.
7. **Judge gap**: the judge isn't told about `lowSunAllDay`.

### Run 2: 2026-11-10 21:03 UTC · Stage 2 · first run

| # | Scenario | Checks | Useful | Light | Clarity | Specific | Biggest weakness (judge) |
|---|---|---|---|---|---|---|---|
| 1 | Baker Beach sunset couple | ✓ all | 3 | 3 | 3 | 3 | Aperture priority with a "fixed" 1/160 (**display bug**: meant as minimum shutter); no backlit-face exposure guidance. |
| 2 | Bethesda Terrace slow kit lens | ✓ all | 3 | 3 | 3 | 3 | 2° morning sun ranked first though trees and buildings likely block it; "fixed" shutter. |
| 3 | Joshua Tree summer midday | ✓ all | 3 | 4 | 3 | 3 | "UTC timestamps" (**judge bug**: judge read stored UTC, the UI shows local); jargon; "fixed" shutter. |
| 4 | Kerry Park December trio | ✓ all | 3 | 2 | 3 | 3 | Assumes sunny backlight with the skyline behind; skyline is SSE, sun SW; Seattle December likely overcast. |
| 5 | Golden Gate Park forest | ✓ all | 2 | 2 | 3 | 3 | Ignores the "under the trees" request (**prompt gap**: notes weren't treated as requirements). |
| 6 | Santa Monica Pier summer group | ✓ all | 3 | 4 | 3 | 3 | Ignores crowds; "fixed" 1/250 in aperture priority. |
| 7 | Chicago Riverwalk winter | ✓ all | 3 | 3 | 3 | 3 | Fixed 1/160 at f/4 underexposes at blue hour on a 3200-ISO body. |
| 8 | Reykjavík solstice | ✓ all | 2 | 2 | 3 | 3 | Treats the low solstice sun as open shade; doesn't use the low directional light. |
| 9 | Horseshoe Bend couple | ✓ all | 3 | 3 | 3 | 2 | No canyon shadow handling; a pose puts the drop-off "behind the camera", conflicting with the layout. |
| 10 | South Pointe sunrise | ✓ all | 3 | 4 | 3 | 3 | "UTC timestamps" (**judge bug**); "fixed" shutter; sunset-timed silhouette pose at sunrise. |

**Stage 1 vs Stage 2 (first look):**
- **Mechanics improved:** 10/10 checks (partly by construction; see ADR-017), 23% faster, 29% fewer tokens.
- **Judged quality fell:** Useful 3.5 → 2.8, Specific 3.5 → 2.9; Light 2.8 → 3.0; Clarity flat at 3.0.
- **Part of the drop is measurement:** the judge saw raw UTC times (Stage 2 plans stored them exactly as Stage 1 did, but its shorter text no longer restates local times), and aperture-priority shutter speeds read as fixed values. Fixed in ADR-020; both runs get **re-scored with the same judge** before concluding.
- **Part is real:** word limits squeezed out location detail; photographer notes weren't treated as requirements; still no terrain knowledge.

### Run 1: 2026-11-10 20:28 UTC · Stage 1 · **official baseline**

| # | Scenario | Checks | Useful | Light | Clarity | Specific | Biggest weakness (judge) |
|---|---|---|---|---|---|---|---|
| 1 | Baker Beach sunset couple | ✓ all | 4 | 3 | 3 | 4 | Summary says face the couple toward the sun (contradicts backlight); misplaces the Golden Gate (it's north). |
| 2 | Bethesda Terrace slow kit lens | ✗ windows | 3 | 2 | 3 | 4 | Ranks a pre-golden window; states sun 6–12° up, contradicting the 3.8° fact. |
| 3 | Joshua Tree summer midday | ✓ all | 4 | 3 | 3 | 4 | Photographer placement contradicts itself; bonus window clipped vs. its own label. |
| 4 | Kerry Park December trio | ✓ all | 4 | 3 | 3 | 3 | Misstates sun height; overcast (the likeliest case) is an afterthought; no concrete shelter. |
| 5 | Golden Gate Park forest | ✓ all | 3 | 3 | 3 | 4 | "Back to me, face the sun" contradicts rim light; shutter 1/250 vs 1/160 conflict. |
| 6 | Santa Monica Pier summer group | ✗ windows | 3 | 2 | 3 | 3 | Rank-2 window not near golden hour, with made-up sun elevations; main group shots placed there. |
| 7 | Chicago Riverwalk winter | ✓ all | 4 | 3 | 3 | 4 | Assumes a 4° sun reaches the canyon-like Riverwalk; 1/200 floor underexposes blue hour. |
| 8 | Reykjavík solstice | ✗ windows | 3 | 2 | 3 | 3 | Calls low sun "golden-ish" with no golden hour; placement conflicts with a southern sun. |
| 9 | Horseshoe Bend couple | ✓ all | 3 | 3 | 3 | 3 | Ignores canyon shadow; colorful backdrop claimed while backlighting at 2°; window starts before golden hour. |
| 10 | South Pointe sunrise | ✓ all | 4 | 4 | 3 | 3 | 1/500 at f/2.8 with ISO ≤ 6400 unrealistic pre-sunrise; window overruns golden hour end. |

**Stage 1 baseline: what fails and why**
1. **Invented or misquoted numbers** (#2, #4, #6, #10): sun elevations and window edges typed by the model drift from the tool facts, even though the facts were in context.
2. **Internal contradictions** (#1, #3, #5, #8): the summary, placement, and poses disagree about where the sun is. One long generation keeps losing track of its own decisions.
3. **Unrealistic exposure** (#7, #10): shutter/ISO targets that can't be met in dim light. There's no computed exposure baseline yet (CLAUDE.md lists one; it was never built).
4. **No place knowledge** (#1 Golden Gate direction, #7 building canyon, #9 canyon shadow): no terrain or landmark facts.
5. **Clarity flat at 3** on every plan: the word wall.

**Noise:** Between Run 0 and Run 1 (same agent), individual scenarios flipped (e.g. #5 failed then passed; #3 passed both). With 10 scenarios × 1 run, treat differences of ±1 scenario or ±0.3 in a judge average as noise. Run 1's Light score is *lower* than Run 0's (2.8 vs 3.1) mainly because the judge now sees full facts and catches more.

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


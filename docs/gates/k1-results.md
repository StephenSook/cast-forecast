# K1 results: can YouCam Makeup VTO render a sunscreen-like film, with coverage as the dose?

Run on 2026-10-27 at about 19:29 ET with the code at commit f0cbe98. 42 Makeup VTO renders, 42 API units (balance 940 to 898). Photo A for the sweep, photo B (same person) for the inverse check, each sent as a metadata-free sRGB copy resized to fit width < 1920 and height < 1080 (A 697 x 1079, B 670 x 1079).

An earlier attempt stopped on its first render with `error_exceed_max_image_size` and spent 0 units; its record is [k1-attempt1-stop.json](k1-attempt1-stop.json). The input copies were then resized to the limits above (commits 0638b06 and f0cbe98) and the run below started from scratch. No criterion changed between the two attempts.

## Pass rule (written before any K1 data)
Written in the module docstring of `castforecast/k1_render.py` at 14a283a. Three amendments were committed in the code at 808cdea, before any K1 render existed; the rule below is the one that ran. All five criteria must hold.

Renders on A: palettes #FFFFFF, #D2D2D2 and #BDBDBD, colorIntensity 50 and 100, coverageIntensity 0, 20, 40, 60, 80 and 100 (36 renders). Blend model on the pooled cheek patch, in linear RGB: render = (1 - a) x skin + a x palette, with a one non-decreasing function of coverage for each colorIntensity, shared by the three palettes.

1. Monotonic: in each of the 6 (palette, colorIntensity) series, cheek L* is non-decreasing with coverage within 0.5 L* of the running maximum; each series needs at least 4 usable points including coverage 100 (amended at 808cdea; the original asked for 2).
2. Fit: R^2 of the blend model at least 0.95 over all usable A renders, 3 channels each.
3. Brightness: the best A render raises cheek L* by at least 15 over the input.
4. Inverse: B rendered at the (coverage, colorIntensity) the fit picks for blend strength 0.35 toward #D2D2D2 lands within dE00 2.0 of its target colour; an unreachable target fails (amended at 808cdea).
5. Texture: for usable A renders with fitted a at least 0.2, the observed texture ratio (render vs input high-frequency energy on the cheek) is within 20 percent of the ratio of an ideal film synthesized on the input in linear light at the same a and palette, for at least 80 percent of them (amended at 808cdea; the original compared against 1 - a directly).

## Result

| Criterion | Bar | Measured | Result |
|---|---|---|---|
| 1. Monotonic | no reversal over 0.5 L*, >= 4 usable incl. coverage 100 | reversal at coverage 60 in 3 of 6 series: #FFFFFF ci50 (77.25 after 77.94), #D2D2D2 ci50 (74.01 after 74.52), #BDBDBD ci100 (74.26 after 74.77); all 6 series had 6 usable points | FAIL |
| 2. Fit | R^2 >= 0.95 | 0.954 over 36 renders | PASS |
| 3. Brightness | dL* >= +15 | +12.7 (70.3 to 83.0) | FAIL |
| 4. Inverse at 0.35 | dE00 <= 2.0, reachable | 2.03 (colorIntensity 100, coverage 0, reachable) | FAIL |
| 5. Texture | >= 80 percent within 20 percent | 10 of 18 eligible renders (56 percent) | FAIL |

Verdict: **FAIL** on 4 of 5 criteria. No render was lost to a missed face (0 of 36).

Other measured values (recorded by the run, not criteria):
- Fitted blend strength a by coverage 0 to 100: about 0.361 to 0.366 at colorIntensity 100 and 0.185 at every coverage at colorIntensity 50.
- The five other inverse renders on B (targets 0.10, 0.20, 0.50, 0.60, 0.70) landed 2.41, 4.89, 2.26, 4.29 and 6.48 dE00 from their targets; the last three targets were above the fitted curve (unreachable).
- Coverage-0 renders differ from the input cheek by 3.6 to 11.6 dE00; recorded and never subtracted.

The decision rule for a K1 failure was to stop this approach. Instead, one retest with a different dose model was pre-registered before any of its data existed: [k1b-preregistration.md](k1b-preregistration.md), result in [k1b-results.md](k1b-results.md). This K1 result stands as recorded.

## Limits
One person, one lighting condition, the colour and texture of a cheek patch only. It tests the renderer, not any sunscreen.

## Published data
[k1-results.json](k1-results.json) and [k1-attempt1-stop.json](k1-attempt1-stop.json) were written by `scripts/publish_results.py` from the private run files. Removed: the input file names (`selfie_a`, `selfie_b`), the upload file ids (`file_ids`), the task id of every render (42 in the run, 1 in the stopped attempt, plus the stopped attempt's `error.task_id`), and the size of the original photos (`preflight` bytes, width, height and short side for A and B). In the stopped attempt's error message the task id is replaced by `[id removed]`. Every other field and every number is unchanged.

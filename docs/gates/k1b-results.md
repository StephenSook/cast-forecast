# K1b results (run 2026-10-27 after the pre-registration and its addendum were committed)

Run on 2026-10-27, finishing at about 20:14 ET, with the code at commit 4b2b415, after the pre-registration (cfce54e) and its addendum (f89ded2) were committed and pushed. 19 renders, 19 API units (balance 898 to 879). All 16 A renders usable.

Library versions in the project environment, installed before every gate run and identical to `requirements.lock`: numpy 2.5.4, pillow 13.0.0, opencv-python-headless 5.0.0.93, colour-science 0.4.7, mediapipe 1.1.1 (Python 3.12.5).

Verdict: **PASS** on all five pre-registered criteria.

| Criterion | Measured | Pre-registered bar | Result |
|---|---|---|---|
| 1. Cheek L* non-decreasing in colorIntensity (#FFFFFF, coverage 0 and 100) | 70.3 to 83.0, no reversal in either series | within 0.5 L*, >= 5 of 6 usable incl. ci 100 | PASS |
| 2. Blend model fit over all 16 A renders | R^2 = 0.982 | >= 0.95, all 16 usable | PASS |
| 3. Capability g(100) | 0.355 | >= 0.219 | PASS |
| 4. Inverse on B, target blend 0.169 | dE00 = 1.17 | <= 2.0 | PASS |
| 5. Texture vs ideal film (coverage 100, g >= 0.10) | 8 of 8 within 20 percent | >= 80 percent | PASS |

Fitted blend strength g by colorIntensity (isotonic): 0: 0.000, 20: 0.069, 40: 0.140, 60: 0.205, 80: 0.273, 100: 0.355 (close to linear, about 0.0035 per point).

All three inverse renders on B (toward #FFFFFF at coverage 100; criterion 4 scores only the 0.169 target):

| Target blend | colorIntensity used | Blend the fit predicts there | dE00 to target |
|---|---|---|---|
| 0.10 | 29 | 0.101 | 0.79 |
| 0.169 (criterion 4) | 49 | 0.170 | 1.17 |
| 0.25 | 73 | 0.249 | 1.49 |

## Descriptive reading (not pre-registered, not part of the verdict)
- colorIntensity sets how strongly the cheek blends toward the palette colour: one curve g fits both coverage settings and all three palettes (R^2 0.982 above).
- coverageIntensity changes texture only when there is colour to apply. At colorIntensity 0, coverage 100 left the texture ratio (render vs input high-frequency energy on the cheek) at about 0.997, the same as coverage 0. At colorIntensity 100, coverage 100 lowered it from about 0.75 to 0.52.
- The three inverse renders landed 0.79 to 1.49 dE00 from their targets. That is three targets on one person, not a general accuracy figure.

Limits: one person, one lighting condition, lightness, colour and texture of a cheek patch only; this test is about the renderer, not about any sunscreen. The earlier K1 run (wrong dose axis) failed and stays on record: [k1-results.md](k1-results.md).

## Published data
[k1b-results.json](k1b-results.json) is written by `scripts/publish_results.py` from the private run file. Removed: the input file names (`selfie_a`, `selfie_b`), the upload file ids (`file_ids`), the `task_id` of each of the 19 renders (16 in `renders`, 3 in `inverse_renders`), and the size of the original photos (`preflight` bytes, width, height and short side for A and B). Every other field and every number is unchanged. The first published version (7bcab02) still carried the four preflight size fields; they were removed when the file was regenerated through the publisher.

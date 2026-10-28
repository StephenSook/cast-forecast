# K1b results (run 2026-10-27 after the pre-registration and its addendum were committed)

Verdict: **PASS** on all five pre-registered criteria. 19 renders, 19 API units (balance 898 to 879). All 16 A renders usable.

| Criterion | Measured | Pre-registered bar | Result |
|---|---|---|---|
| 1. Cheek L* non-decreasing in colorIntensity (#FFFFFF, coverage 0 and 100) | 70.3 to 83.0, no reversal in either series | within 0.5 L*, >= 5 of 6 usable incl. ci 100 | PASS |
| 2. Blend model fit over all 16 A renders | R^2 = 0.982 | >= 0.95, all 16 usable | PASS |
| 3. Capability g(100) | 0.355 | >= 0.219 | PASS |
| 4. Inverse on B, target blend 0.169 | dE00 = 1.17 | <= 2.0 | PASS |
| 5. Texture vs ideal film (coverage 100, g >= 0.10) | 8 of 8 within 20 percent | >= 80 percent | PASS |

Fitted blend strength g by colorIntensity (isotonic): 0: 0.000, 20: 0.069, 40: 0.140, 60: 0.205, 80: 0.273, 100: 0.355 (close to linear, about 0.0035 per point).

Reading: in YouCam Makeup VTO's foundation effect, colorIntensity sets how strongly the skin blends toward the palette colour and coverageIntensity sets texture; together they reproduce a film-like whitening on a real face, and a target blend can be hit within dE00 1.2. Limits: one person, one lighting condition, lightness and colour of a cheek patch only; this test is about the renderer, not about any sunscreen. The earlier K1 run (wrong dose axis) failed and stays on record.

Full numbers: k1b-results.json (sanitized: no images, no file or task ids, no local paths).

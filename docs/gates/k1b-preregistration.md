# K1b pre-registration: can YouCam Makeup VTO render a sunscreen-like film?

Written and committed on 2026-10-27 before any K1b render was requested. This is a one-shot retest. If K1b fails, the project stops this approach and switches to its fallback; there is no K1c.

## Why a retest exists
The first render test (K1) failed all but one of its pre-registered criteria. Its renders showed that the test assumed the wrong control: in Makeup VTO's foundation effect, `colorIntensity` sets how strongly the skin colour blends toward the palette colour (fitted blend strength about 0.36 at 100 and about 0.19 at 50, flat across coverage), while `coverageIntensity` changes skin texture (texture ratio about 0.75 at coverage 0 down to about 0.52 at 100). K1 treated coverage as the dose. K1 also set its brightness bar (+15 L*) from deep skin while the test photo reads L* about 70. K1's result stands as recorded; K1b tests the corrected model.

## Inputs
- Photo A and photo B: the same consenting person, metadata-free sRGB copies resized to fit width < 1920 and height < 1080 (A 697 x 1079, B 670 x 1079).
- Every render sends `skin_smooth` with strength 0 and colour intensity 0, `glowIntensity` 0.

## Renders (19 paid calls)
1. Dose sweep on A: palette #FFFFFF, colorIntensity {0, 20, 40, 60, 80, 100} x coverageIntensity {0, 100}: 12 renders.
2. Colour generality on A: palettes #D2D2D2 and #BDBDBD, colorIntensity {40, 100}, coverage 100: 4 renders.
3. Inverse on B: target blend strengths {0.10, 0.169, 0.25} toward #FFFFFF at coverage 100, colorIntensity chosen by inverting the fitted curve (rounded to an integer): 3 renders.

## Model
On the pooled cheek patch, in linear RGB: render = (1 - g(colorIntensity)) x skin + g(colorIntensity) x palette, where skin is the cheek of the uploaded copy and g is one monotone non-decreasing curve in colorIntensity, shared across coverage and palettes, fitted by least squares per colorIntensity level and made monotone by isotonic regression.

## Criteria (all five must pass)
1. Monotonic: for palette #FFFFFF at each coverage, cheek L* is non-decreasing with colorIntensity within 0.5 L*; each series needs at least 5 of 6 usable points including colorIntensity 100.
2. Fit: R^2 >= 0.95 for the model above over all 16 A renders (3 channels each).
3. Capability: g(100) >= 0.219, which is the blend strength needed to reproduce the largest whitening measured in the PLOS ONE 2025 study (dark-skin group, 30 percent zinc oxide: L* 46.28 to 61.45, required blend strength 0.169) plus a 0.05 margin. Note: K1 already measured g(100) near 0.36, so this criterion is a re-measurement, not an independent test.
4. Inverse: the B render for target 0.169 lands within dE00 2.0 of its target cheek colour; an unreachable target fails.
5. Texture: among A renders at coverage 100 with g >= 0.10, the observed texture ratio (render vs input high-frequency energy, each measured with its own cheek detection) is within 20 percent of the ratio of an ideal film synthesized on the input in linear light at the same g and palette, for at least 80 percent of them; an empty set fails.

Unchanged from K1: the 0.5 L* tolerance, R^2 0.95, dE00 2.0, and the 20 percent / 80 percent texture band. Changed: the dose axis (colorIntensity) and the capability bar (blend strength for the study's worst measured case instead of a raw L* rise on this photo).

## Decision
K1b pass: continue Cast Forecast with YouCam Makeup VTO as the renderer (colorIntensity for the cast strength, coverage for texture). K1b fail: switch to the fallback project. Results will be published next to this file whichever way they land.

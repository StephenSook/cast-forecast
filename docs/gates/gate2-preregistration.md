# Gate 2 pre-registration: does a bottle's film, measured on two cards, predict its whitening on skin?

Written 2026-10-28, 14:31 EDT, and committed before any Gate 2 photo was taken. Gate 1 asked this question of published lab data and failed (film model 4.79 L* mean error vs label model 1.61). Gate 2 asks it again, prospectively, on retail bottles measured with a phone. Everything here is about how white a product looks on skin. It says nothing about sun protection.

## Subject and bottles
- Subject S01: the builder, consenting. Inner forearms, both arms, one session.
- Bottles: whatever retail sunscreens are on hand when the session starts (bottles already owned, store samples, bottles from the household). Each bottle's active ingredients and percentages are read from its own label and photographed before it is used. Label mineral percent m = zinc oxide % + titanium dioxide %. A bottle with neither is an organic-only control (m = 0).
- Forearm bottles, chosen by this rule before any photo: at most one organic-only control, then the bottles with the highest m, up to four in total; ties go to the bottle whose code sorts first. Two treated squares per arm.

## Capture
- Phone RAW (Apple ProRAW, DNG), one fixed desk lamp, a sheet of plain white printer paper in every frame, phone fixed above the scene.
- Dose: 0.04 mL from a 1 mL oral syringe onto a 4 cm x 5 cm square (about 2 uL per cm2), spread for 20 seconds with a clean gloved fingertip. The same dose goes on a black card, a white card (each made non-porous with clear tape, with a bare area next to the square) and a forearm square.
- Forearm: three squares in a line on each inner forearm, two treated (A, B) and one untreated control (U) between them.
- Photos: BASE (before any product), then T00, T05 and T15 minutes after the last square is dosed. Each time point flash off, then flash on.
- Primary frame for everything in this gate: T15, flash off. Every other frame is descriptive.

## Measurement
- RAW files are decoded to linear RGB with LibRaw (camera white balance, no auto-brightening, no gamma). The exact decoder settings are written into the analysis code before any outcome is computed. If LibRaw cannot read these files, the fallback decoder and its settings are recorded the same way, before any outcome is computed.
- Regions: on each photo series, rectangles are placed by hand once, on the T00 flash-off frame, and reused for every frame of that series: inside each treated square (inset at least 5 mm from its edges), on the bare card area next to it (same size), on U, and on the white paper. The region coordinates are saved to a file before any reflectance or L* value is computed.
- Reflectance per channel = region mean / white-paper mean x 0.88. The paper's reflectance (0.88) is an assumption, not a measurement; the result is also reported at 0.80 and 0.95, and the verdict uses 0.88.
- L* from linear sRGB (D65) luminance Y with a perfect white at Y = 1.

## Outcome (what is predicted)
For each treated square s, the drift-corrected whitening is

  dL*obs = [L*s(T15) - L*s(BASE)] - [L*U(T15) - L*U(BASE)]

using the untreated square U on the same arm to remove any change in light or exposure between BASE and T15.

## Models (fixed now; not changed after seeing results)
- Film from the cards. On the bottle's black and white cards at T15 flash off, per channel, solve the single-layer film equation rho' = R + T^2 rho / (1 - R rho) for the film's reflectance R and transmittance T, using the bare and coated reflectance of each card (two equations, two unknowns), with R >= 0, T >= 0 and R + T <= 1. No admissible solution in any channel makes that bottle's film unsolvable.
- F1 (primary, one parameter): the same film at thickness scale t (one value shared by all bottles, 0.1 <= t <= 3.0), computed from R and T with the Kubelka formulas for a layer of scaled thickness, then laid over square s's own BASE reflectance with the equation above. Predicted whitening = L*(predicted) - L*s(BASE). t is fitted leave-one-bottle-out by least squares on the other bottles' squares.
- F0 (descriptive): F1 with t = 1, no fitted parameter.
- B (label, two parameters): dL* = (a + c x m) x (100 - L*s(BASE)), the published study's own normalisation already used as Gate 1's label model, fitted leave-one-bottle-out by least squares.
- An unsolvable film predicts zero whitening for that bottle under F0 and F1 (no exclusion).

## Pass rule (all three must hold)
1. F1's mean absolute error over all treated squares is smaller than B's.
2. F1's mean absolute error is 2.0 L* or less.
3. Testable: at least four treated squares, from at least three different values of m, and at least two squares with dL*obs of 2.0 L* or more. If this fails, Gate 2 has no verdict ("not testable"), which is reported as such and counts as no prediction claim.

## Validity checks (written now)
- If an arm's untreated square drifts by more than 1.5 L* between BASE and T15, that arm's squares are excluded and the exclusion is reported. One reshoot of that arm is allowed on another day, scored by the same rule.
- Reported, never used for the verdict: F0's error, the paper-reflectance sensitivity (0.80, 0.95), Spearman rank agreement of F1 with the observed order, flash-on vs flash-off whitening per bottle (a relative, within-photo estimate), and the T00 / T05 / T15 dry-down.
- Scope: Gate 2 is scored once, on S01's squares from the first session. Squares from any later recruit are a separate, descriptive check.

## Decision
- PASS: the site may say that a bottle's card measurement predicts its whitening on skin, quoting Gate 2's error and its one subject.
- FAIL or not testable: the site shows each bottle's measured whitening (cards, and S01's forearm where measured) as a record only, makes no prediction claim, and labels every render on a shopper's photo as an approximation built from the card measurement.

Results will be published next to this file whichever way they land. Any analysis not written here is labelled post hoc.

## Amendment 1 (2026-10-28, 14:37 EDT, after an adversarial review, still before any Gate 2 photo)
These rules replace the lines they name. Everything else above stands.

1. Regions (replaces "Regions"). Before any product goes on, every card window and every forearm square gets four small marker dots just outside its stencil corners. On each frame the analyst marks only those four dots per square and the four corners of the white paper; nothing else is chosen by hand. A script then computes every region from the dots: the treated region is the 4 cm x 5 cm window shrunk 5 mm on every side; the bare card region is two 3 cm x 1.5 cm rectangles on the card, one above and one below the window, each starting 5 mm beyond the window edge; the untreated square's region is its window shrunk 5 mm; the paper region is the central half (by area) of the sheet. Pixels at the sensor clip level in any channel are dropped; a region with more than 5 percent of its pixels dropped, or a square whose dots cannot be found, is unusable.
2. Film usability (replaces "No admissible solution ..." and "An unsolvable film predicts zero whitening ..."; superseded by Amendment 2 rule 6 for acceptance and boundary handling). A channel's solve is accepted when R >= -0.02, T^2 >= -0.02 and R + T <= 1.03, a tolerance for noise and for the assumed paper scale; R and T^2 are then clamped at zero and T is lowered until R + T <= 1. A bottle's film is usable only when all three channels are accepted at paper scale 0.88. A bottle without a usable film is a failed measurement: its squares are left out of every model and the count is reported. It never predicts zero.
3. Validity before models (replaces the first validity bullet). Validity is decided for every arm before any whitening value or prediction is computed: dots found on BASE and T15 flash off, no unusable region, and the untreated square's drift within 1.5 L*. An arm that fails is reshot once, on a later day, with the same bottles on the same arm and a new BASE (the cards are not repeated); its new squares replace the failed ones. If the reshoot also fails, Gate 2 is not testable. There are no other retries. The scope line "scored once, on S01's squares from the first session" now reads "scored once, on S01's valid squares (first session plus at most one reshoot of a failed arm)".
4. Pass rule (replaces it). All three must hold:
   1. Testable: at least four valid treated squares with usable films, from at least three different values of m, with at least two squares at dL*obs of 2.0 L* or more. Otherwise "not testable". With four forearm bottles this means a single film failure makes the gate not testable; it can never be absorbed.
   2. F1's mean absolute error is at least 0.5 L* smaller than each of three rivals: B; zero whitening for every square; and the mean observed whitening of the other bottles (leave-one-bottle-out). The 0.5 L* margin is a set practical margin, not a significance test.
   3. F1's mean absolute error is 2.0 L* or less.
5. Decision (replaces the PASS line). Gate 2 is a one-person pilot. PASS allows only this claim: "In a one-person pilot (N bottles, S capture sessions, film thickness calibrated on the same person), the card measurement predicted forearm whitening within X L* on average, better than the label's mineral percent." S is the real number of sessions, and any arm replaced under rule 3 is named next to the claim. No claim that card measurements predict whitening on anyone else's skin. Renders on a shopper's photo stay labelled as an approximation built from the card measurement, whichever way Gate 2 lands.

## Amendment 2 (2026-10-28, 14:40 EDT, after the second adversarial review, still before any Gate 2 photo)
6. Film acceptance and boundaries (replaces the constraints "R >= 0, T >= 0 and R + T <= 1" in "Film from the cards", and the acceptance sentence of Amendment 1 rule 2; the rest of rule 2 stands). Per channel:
   - Accept when -0.02 <= R <= 1, T^2 >= -0.02 and R + T <= 1.03. Anything else, including R > 1, is not accepted.
   - Then set R and T^2 to zero where they are negative, and if R + T > 1, set T = 1 - R (the film is then treated as non-absorbing).
   - Thickness scaling at scale t, by case, checked in this order: T = 0 (opaque): R and T unchanged. R = 0 (absorbs, does not scatter): R(t) = 0, T(t) = T^t. R + T = 1 within 1e-9 (scatters, does not absorb; the general formula is singular here): with q = R / T, R(t) = q t / (1 + q t) and T(t) = 1 / (1 + q t). Otherwise the general Kubelka layer formulas.
   - The code implementing these cases is tested on each boundary before any photo is analysed.

## Amendment 3 (2026-10-28, 14:43 EDT, after the third adversarial review, still before any Gate 2 photo)
7. Thickness fit (replaces "t is fitted leave-one-bottle-out by least squares on the other bottles' squares"). For each held-out bottle, t is chosen by a fixed grid search over t = 0.100, 0.101, ..., 3.000 (2,901 values) minimizing the sum of squared whitening errors on the other bottles' squares. Every grid value whose sum is within 1e-9 of the minimum counts as tied; among tied values the one closest to t = 1.000 (the measured card thickness) is used, and if two are equally close, the smaller. So a training set that cannot identify t (for example, all opaque films) falls back to the measured thickness, and every fold has exactly one t. This case is in the tests before any photo is analysed.

## Amendment 4 (2026-10-28, 14:46 EDT, after the fourth adversarial review, still before any Gate 2 photo)
8. Acceptance sequence (makes rule 6 exact; it does not change the bounds). Per channel, in this order: (a) reject if the raw R < -0.02, R > 1, or T^2 < -0.02; (b) set R = max(R, 0) and T = sqrt(max(T^2, 0)), so a slightly negative T^2 gives an opaque channel (T = 0); (c) reject if R + T > 1.03, using these clamped values; (d) if R + T > 1, set T = 1 - R. A raw solve with T^2 between -0.02 and 0 is therefore accepted as opaque, never rejected. This case is in the tests before any photo is analysed.

## Status (2026-10-29): not run
No Gate 2 photo was ever taken. On 2026-10-28 the builder decided not to run the in-person session (black and white cards, forearm squares), so Gate 2 has no data and no verdict, and no claim on the site rests on it. The analysis code written for it stays in the repository (castforecast/raw.py, regions.py, dots.py, measure.py, film.py, gate2.py), reviewed but never run on Gate 2 data. The catalogue instead predicts each bottle's whitening from its FDA label's zinc oxide percentage with the label model Gate 1 tested (castforecast/label_model.py), and states that model's error.

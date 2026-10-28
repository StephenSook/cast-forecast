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

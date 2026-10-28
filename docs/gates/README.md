# Gates

Every claim Cast Forecast makes passes a written gate first. Each gate states its pass rule before the data exists, and the result is kept whichever way it lands.

| Gate | Question | Rule written before data | Result |
|---|---|---|---|
| Gate 1 | Does a film model measured over black and white backgrounds predict on-skin whitening better than the label's zinc percentage? (PLOS ONE 2025 raw data, 13 volunteers, held out by person and by formulation) | Yes, in the test script before the first run | FAIL: film model 4.79 L* mean error vs label model 1.61. Exploratory only: on the one differently formulated product, a one-parameter film model missed by 0.69 L* vs the label's 2.35. |
| K2 | Is YouCam's skin tone analysis a usable measurement of the colour in a photo? | Yes, in the plan before the run | FAIL as a measurement: identical result on a fresh upload, but it barely moves when the photo is 10 percent brighter (0.15x) and sits 15.1 dE00 from the measured cheek. It reports a lighting-normalized tone. |
| K1 | Can YouCam Makeup VTO render a sunscreen-like film, with coverage as the dose? | Yes, in the plan before the run | FAIL: the renders showed colorIntensity, not coverage, is the dose. |
| K1b | Same question with colorIntensity as the dose and coverage as texture | Yes: [k1b-preregistration.md](k1b-preregistration.md), committed and pushed before any K1b render | PASS 5 of 5: [k1b-results.md](k1b-results.md) |

Sources: Maldonado Lopez et al., PLOS ONE 2025, doi 10.1371/journal.pone.0319891; raw data Mendeley Data jfpzx7hcz2 v2.

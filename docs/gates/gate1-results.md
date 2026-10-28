# Gate 1 results: does a measured film model predict on-skin whitening better than the label's zinc percentage?

Data: the raw data of Maldonado Lopez et al., PLOS ONE 2025 (doi 10.1371/journal.pone.0319891), Mendeley Data jfpzx7hcz2 version 2. In vivo: L* before and after application on 13 volunteers, 6 formulations (0, 5, 10, 20 and 30 percent zinc oxide, plus a 14.7 percent "benchmark" product formulated differently), 3 replicate pairs each. In vitro: L* of the same formulations on VITRO-SKIN over black and over white backgrounds. The spreadsheets are not redistributed here; [analysis/gate1/fetch_data.py](../../analysis/gate1/fetch_data.py) downloads them and checks each SHA-256 against the copy the analysis ran on.

## Pre-registered rule
Quoted verbatim from the header of [analysis/gate1/heldout_test.py](../../analysis/gate1/heldout_test.py):

```
PRE-REGISTERED GATE (written before the first run, 2026-10-27 ~18:40 ET):
  Compare, on ZnO > 0 cells only, in STRICT leave-one-cell-out (calibration excludes the
  held-out volunteer AND the held-out formulation), the film model F2 (2 params: film
  thickness scale t, score offset a) against the label-percent baseline B1i (2 params:
  paper's own normalisation, dL* = (a + c * ZnO%) * (100 - L*before)).
  PASS if BOTH:
    (1) F2 overall MAE < B1i overall MAE, and
    (2) on the 14.7% benchmark (a differently formulated product), F2 MAE < B1i MAE.
  Report the dark-skin subgroup (ITA Brown + Tan) separately; report everything else as
  descriptive. Do not change model forms after seeing results; any later variant is
  labelled post hoc.
```

## What is known about timing, and what changed after the first run
- The time in the header is wrong. It was typed by hand. The file timestamps and the working session's log show the script, with this header, was written at about 18:17 ET on 2026-10-27 and first run seconds later. The header text did not change after that first run.
- Before the rule was written, the first rows of each spreadsheet were printed to learn their layout; no model had been fitted to the raw data. Before that, the film model had only been checked in-sample against the regression lines printed in the paper.
- The first run included one impossible reading: invivo.xlsx cell D178 (volunteer A839, 30 percent zinc oxide), L* before = 533.92, outside the 0 to 100 scale. A filter that drops readings outside 0 to 100 was then added (it is marked in the script) and the test was run again less than a minute later; that second run is the result below. The first run also failed the gate (overall 23.23 vs 6.05). Its benchmark criterion read 5.70 vs 7.30, a pass, only because the impossible value distorted the label model's fit; with the reading dropped it is 5.70 vs 2.35, a fail. Dropping the reading made the result worse for the film model, not better.
- The script lived in a private working folder and was committed to this repository after the run. The published copy is byte-identical to the one that ran, and on freshly downloaded data it reproduces the output below exactly.

## Result
Strict leave-one-cell-out, cells with zinc oxide above 0 (n = 65). Mean absolute error of the predicted L* change, in L* units.

| Model | Overall | Dark-skin subgroup (ITA Brown and Tan), descriptive | Benchmark product |
|---|---|---|---|
| Label percent, the paper's score (2 parameters), baseline | 1.61 | 1.80 | 2.35 |
| Film + thickness + offset (2 parameters), gate model | 4.79 | 6.51 | 5.70 |
| Film, no calibration (descriptive) | 8.41 | 11.08 | 2.64 |
| Film + thickness (1 parameter, descriptive) | 6.90 | 8.82 | 1.25 |

| Criterion | Film model | Label model | Result |
|---|---|---|---|
| (1) Overall MAE lower than the label model | 4.79 | 1.61 | FAIL |
| (2) Benchmark MAE lower than the label model | 5.70 | 2.35 | FAIL |

Verdict: **FAIL**.

Also printed by the run: the replicate noise floor (standard error of each cell's mean L* change) has a median of 0.41 L*.

## Post hoc analysis (exploratory; written after the gate failed and cannot change the verdict)
After the result, a defect was found in the gate model. For the 10, 20 and 30 percent films the black and white solve gives R0 + T slightly above 1 (1.005 to 1.009), and the code then skipped the thickness calibration for those films. [heldout_posthoc.py](../../analysis/gate1/heldout_posthoc.py) projects those films onto R0 + T = 0.999 so the thickness scale applies to every film. Same strict scheme:

| Model | Overall | Dark-skin subgroup | Benchmark product |
|---|---|---|---|
| Label percent (2 parameters) | 1.61 | 1.80 | 2.35 |
| Film + thickness (1 parameter) | 2.25 | 2.52 | 0.69 |
| Film + thickness + offset (2 parameters) | 2.27 | 2.56 | 2.57 |

Exploratory reading: overall, the label percentage plus skin lightness still predicts better than the film model. On the one differently formulated product, the one-parameter film model missed by 0.69 L* where the label model missed by 2.35. That is one product, 13 volunteers and a model fix made after seeing the result: a hypothesis to test on new products, not evidence.

## Reproduce
These scripts are not part of CI because they need the downloaded data. fetch_data.py has offline tests in tests/test_gate1_fetch.py. The two analysis scripts are excluded from ruff so they stay byte-identical to what ran.

```
python -m pip install numpy scipy openpyxl
python analysis/gate1/fetch_data.py
python analysis/gate1/heldout_test.py
python analysis/gate1/heldout_posthoc.py
```

The run used Python 3.12.5, numpy 2.5.2, scipy 1.18.1 and openpyxl 3.1.5, all installed before the run.

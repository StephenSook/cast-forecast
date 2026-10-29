"""Predicted whitening from a bottle's zinc oxide percentage and the skin's lightness.

    dL* = (a + c * ZnO%) * (100 - L*before)

is the normalisation of Maldonado Lopez et al., PLOS ONE 2025 (doi 10.1371/journal.pone.0319891),
fitted by least squares on every cell in data/plos2025/cells.csv (derived from the study's CC BY
4.0 raw data by analysis/label_model/build_cells.py), the 0 percent formulation included, exactly
as Gate 1 fitted it. Gate 1 tested this model on the 65 zinc oxide cells, held out by volunteer and
by formulation: mean absolute error 1.61 L* (docs/gates/gate1-results.md); `held_out_mae`
recomputes that number from the same table.

The study covered zinc oxide only, 5 to 30 percent, on skin with L* from about 44 to 68.
`predict` refuses anything outside that range rather than extrapolating.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

import numpy as np

CELLS = Path(__file__).resolve().parent.parent / "data" / "plos2025" / "cells.csv"


@dataclass(frozen=True)
class Cell:
    volunteer: str
    formulation: str
    zinc_oxide_pct: float
    l_before: float
    dl: float


def load_cells(path: Path = CELLS) -> list[Cell]:
    with open(path, newline="") as f:
        return [
            Cell(
                r["volunteer"],
                r["formulation"],
                float(r["zinc_oxide_pct"]),
                float(r["L_before"]),
                float(r["dL"]),
            )
            for r in csv.DictReader(f)
        ]


def fit(cells: list[Cell]) -> tuple[float, float]:
    """Least-squares (a, c) for dL* = (a + c * ZnO%) * (100 - L*before)."""
    w = np.array([100.0 - c.l_before for c in cells])
    x = np.column_stack([w, w * np.array([c.zinc_oxide_pct for c in cells])])
    (a, c), *_ = np.linalg.lstsq(x, np.array([c.dl for c in cells]), rcond=None)
    return float(a), float(c)


def held_out_mae(targets: list[Cell], pool: list[Cell]) -> float:
    """Gate 1's scheme: each target cell predicted by a fit on the pool minus its volunteer and its
    formulation."""
    errors = []
    for held in targets:
        train = [
            c for c in pool if c.volunteer != held.volunteer and c.formulation != held.formulation
        ]
        a, c = fit(train)
        errors.append(abs((a + c * held.zinc_oxide_pct) * (100.0 - held.l_before) - held.dl))
    return float(np.mean(errors))


ALL_CELLS = load_cells()
ZINC_CELLS = [c for c in ALL_CELLS if c.zinc_oxide_pct > 0]
A, C = fit(ALL_CELLS)
ZINC_RANGE = (min(c.zinc_oxide_pct for c in ZINC_CELLS), max(c.zinc_oxide_pct for c in ZINC_CELLS))
LIGHTNESS_RANGE = (min(c.l_before for c in ZINC_CELLS), max(c.l_before for c in ZINC_CELLS))


def predict(zinc_oxide_pct: float, l_before: float) -> float:
    """Predicted L* change; ValueError outside the zinc and lightness range the study covered."""
    if not ZINC_RANGE[0] <= zinc_oxide_pct <= ZINC_RANGE[1]:
        raise ValueError(
            f"zinc oxide {zinc_oxide_pct}% is outside the study's {ZINC_RANGE[0]:g} to {ZINC_RANGE[1]:g}%"
        )
    if not LIGHTNESS_RANGE[0] <= l_before <= LIGHTNESS_RANGE[1]:
        raise ValueError(
            f"skin L* {l_before:.1f} is outside the study's {LIGHTNESS_RANGE[0]:.1f} to {LIGHTNESS_RANGE[1]:.1f}"
        )
    return (A + C * zinc_oxide_pct) * (100.0 - l_before)

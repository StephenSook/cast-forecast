"""Gate 2 scoring, exactly as docs/gates/gate2-preregistration.md (with Amendments 1 to 3) states it.

Inputs are already-measured squares: each treated square's bottle, label mineral percent m, BASE
linear reflectance (three channels) and drift-corrected observed whitening. Films are per bottle:
three accepted `LayerFilm`s (one per channel) or None when the film is not usable. Nothing here
reads photos; region and validity decisions happen before these numbers exist.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from castforecast.film import LayerFilm, lightness, over, scaled

T_GRID = np.round(np.arange(100, 3001) / 1000.0, 3)  # 0.100 ... 3.000, 2,901 values (rule 7)
TIE = 1e-9
MARGIN = 0.5  # L*, rule 4.2
MAX_MAE = 2.0  # L*, rule 4.3
VISIBLE = 2.0  # L*, rule 4.1

Film3 = tuple[LayerFilm, LayerFilm, LayerFilm]


@dataclass(frozen=True)
class Square:
    bottle: str
    m: float  # label zinc oxide % + titanium dioxide %
    base: np.ndarray  # BASE linear reflectance of the treated square, three channels
    obs: float  # drift-corrected observed whitening, L*


def predict_film(film: Film3, t: float, base: np.ndarray) -> float:
    """Whitening (L*) of the film at thickness scale t laid over the BASE reflectance."""
    after = np.array([over(*_rt(scaled(f, t)), float(b)) for f, b in zip(film, base, strict=True)])
    return lightness(after) - lightness(base)


def _rt(f: LayerFilm) -> tuple[float, float]:
    return f.r, f.t


def fit_thickness(train: list[Square], films: dict[str, Film3 | None]) -> float:
    """Rule 7: grid minimum of squared error; ties go to the t closest to 1.000, then the smaller."""
    sse = np.array(
        [
            sum((predict_film(films[s.bottle], t, s.base) - s.obs) ** 2 for s in train)
            for t in T_GRID
        ]
    )
    tied = T_GRID[sse <= sse.min() + TIE]
    dist = np.abs(tied - 1.0)
    return float(tied[dist == dist.min()].min())


def fit_label(train: list[Square]) -> tuple[float, float]:
    """B: dL* = (a + c m)(100 - L*base), least squares."""
    w = np.array([100.0 - lightness(s.base) for s in train])
    x = np.column_stack([w, w * np.array([s.m for s in train])])
    (a, c), *_ = np.linalg.lstsq(x, np.array([s.obs for s in train]), rcond=None)
    return float(a), float(c)


def _label(a: float, c: float, s: Square) -> float:
    return (a + c * s.m) * (100.0 - lightness(s.base))


def score(squares: list[Square], films: dict[str, Film3 | None]) -> dict:
    """The Gate 2 verdict for valid squares: "PASS", "FAIL" or "not testable", with every error."""
    failed = sorted({s.bottle for s in squares if films.get(s.bottle) is None})
    usable = [s for s in squares if films.get(s.bottle) is not None]
    out: dict = {"failed_films": len(failed), "failed_bottles": failed, "squares": len(usable)}
    testable = (
        len(failed) == 0
        and len(usable) >= 4
        and len({s.m for s in usable}) >= 3
        and sum(s.obs >= VISIBLE for s in usable) >= 2
    )
    if not testable:
        out["verdict"] = "not testable"
        return out
    err = {k: [] for k in ("F1", "F0", "B", "zero", "constant")}
    folds: dict = {}
    for bottle in sorted({s.bottle for s in usable}):
        held = [s for s in usable if s.bottle == bottle]
        train = [s for s in usable if s.bottle != bottle]
        t = fit_thickness(train, films)
        a, c = fit_label(train)
        const = float(np.mean([s.obs for s in train]))
        folds[bottle] = {"t": t, "a": a, "c": c, "constant": const}
        for s in held:
            err["F1"].append(abs(predict_film(films[bottle], t, s.base) - s.obs))
            err["F0"].append(abs(predict_film(films[bottle], 1.0, s.base) - s.obs))
            err["B"].append(abs(_label(a, c, s) - s.obs))
            err["zero"].append(abs(s.obs))
            err["constant"].append(abs(const - s.obs))
    mae = {k: float(np.mean(v)) for k, v in err.items()}
    beats = all(mae["F1"] + MARGIN <= mae[r] for r in ("B", "zero", "constant"))
    out.update(
        verdict="PASS" if beats and mae["F1"] <= MAX_MAE else "FAIL",
        mae=mae,
        folds=folds,
    )
    return out

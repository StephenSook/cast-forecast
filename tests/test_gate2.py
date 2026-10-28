"""Tests for Gate 2 scoring (castforecast/gate2.py), against docs/gates/gate2-preregistration.md."""

import numpy as np
import pytest

from castforecast.film import LayerFilm, lightness, over
from castforecast.gate2 import (
    T_GRID,
    Square,
    fit_label,
    fit_thickness,
    predict_film,
    score,
)


def grey(y):
    return np.array([y, y, y])


def y_of(l_star):
    return ((l_star + 16.0) / 116.0) ** 3


def film3(r, t):
    f = LayerFilm(r, t)
    return (f, f, f)


def test_grid_is_the_registered_one():
    assert len(T_GRID) == 2901
    assert T_GRID[0] == pytest.approx(0.1) and T_GRID[-1] == pytest.approx(3.0)
    assert T_GRID[900] == pytest.approx(1.0)


def test_predict_film_is_the_whitening_of_the_scaled_film_over_base():
    base = grey(0.2)
    f = film3(0.1, 0.85)
    got = predict_film(f, 1.0, base)
    want = lightness(np.array([over(0.1, 0.85, 0.2)] * 3)) - lightness(base)
    assert got == pytest.approx(want)


def test_fit_thickness_recovers_the_true_scale():
    base = grey(0.2)
    films = {"a": film3(0.08, 0.88), "b": film3(0.15, 0.8), "c": film3(0.25, 0.65)}
    truth = 1.7
    squares = [Square(k, 0.0, base, predict_film(f, truth, base)) for k, f in films.items()]
    assert fit_thickness(squares, films) == pytest.approx(truth, abs=1e-3)


def test_fit_thickness_falls_back_to_one_when_unidentifiable():
    # Codex round 3: opaque training films predict the same whitening at every thickness.
    base = grey(y_of(50.0))
    films = {"o1": film3(0.210462, 0.0), "o2": film3(0.407494, 0.0), "o3": film3(0.219746, 0.0)}
    squares = [
        Square("o1", 0, base, 3.0),
        Square("o2", 10, base, 20.0),
        Square("o3", 20, base, 4.0),
    ]
    assert fit_thickness(squares, films) == pytest.approx(1.0)


def test_fit_label_is_the_published_normalisation():
    base_l = 60.0
    base = grey(y_of(base_l))
    a, c = 0.02, 0.004
    squares = [Square(f"b{m}", m, base, (a + c * m) * (100 - base_l)) for m in (0, 5, 10, 20)]
    got_a, got_c = fit_label(squares)
    assert got_a == pytest.approx(a) and got_c == pytest.approx(c)


def _panel(obs, ms, films, base_l=50.0):
    base = grey(y_of(base_l))
    return [Square(f"b{i}", m, base, o) for i, (m, o) in enumerate(zip(ms, obs, strict=True))], {
        f"b{i}": f for i, f in enumerate(films)
    }


def test_codex_counterexample_has_exactly_one_verdict():
    # Round 3 counterexample: three opaque training films, one translucent held out.
    squares, films = _panel(
        [3.0, 20.0, 4.0, 10.0],
        [0, 10, 20, 30],
        [film3(0.210462, 0.0), film3(0.407494, 0.0), film3(0.219746, 0.0), film3(0.3, 0.65)],
    )
    r1 = score(squares, films)
    r2 = score(squares, films)
    assert r1 == r2
    assert r1["folds"]["b3"]["t"] == pytest.approx(1.0)


def test_no_usable_film_is_not_testable_never_a_pass():
    # Codex round 1 counterexample: all films unusable can no longer pass.
    squares, films = _panel([0.0, 2.4, 0.0, 2.4], [0, 10, 20, 30], [None] * 4)
    r = score(squares, films)
    assert r["verdict"] == "not testable"
    assert r["failed_films"] == 4


def test_a_single_film_failure_makes_four_squares_not_testable():
    base_films = [film3(0.02, 0.97), film3(0.1, 0.85), film3(0.2, 0.7), film3(0.3, 0.6)]
    squares, films = _panel([0.5, 4.0, 8.0, 12.0], [0, 6, 15, 25], base_films)
    films["b2"] = None
    assert score(squares, films)["verdict"] == "not testable"


def test_testability_needs_three_m_values_and_two_visible_casts():
    fs = [film3(0.02, 0.97), film3(0.1, 0.85), film3(0.2, 0.7), film3(0.3, 0.6)]
    squares, films = _panel([0.5, 4.0, 8.0, 12.0], [0, 10, 10, 10], fs)
    assert score(squares, films)["verdict"] == "not testable"
    squares, films = _panel([0.5, 0.8, 1.0, 12.0], [0, 6, 15, 25], fs)
    assert score(squares, films)["verdict"] == "not testable"


def test_a_film_that_explains_the_data_passes_and_rivals_are_reported():
    base = grey(y_of(50.0))
    fs = [film3(0.01, 0.98), film3(0.08, 0.88), film3(0.18, 0.74), film3(0.3, 0.6)]
    ms = [0, 6, 25, 15]  # label order deliberately disagrees with the films
    obs = [predict_film(f, 1.3, base) for f in fs]
    squares, films = _panel(obs, ms, fs)
    r = score(squares, films)
    assert r["verdict"] == "PASS", r
    assert r["mae"]["F1"] < 0.1
    for rival in ("B", "zero", "constant"):
        assert r["mae"]["F1"] + 0.5 <= r["mae"][rival]
    assert "F0" in r["mae"]


def test_label_data_fails_the_film():
    base_l = 50.0
    base = grey(y_of(base_l))
    fs = [film3(0.3, 0.6), film3(0.2, 0.7), film3(0.1, 0.85), film3(0.01, 0.98)]
    ms = [0, 8, 16, 24]
    obs = [(0.0 + 0.004 * m) * (100 - base_l) for m in ms]  # whitening follows the label
    squares = [Square(f"b{i}", m, base, o) for i, (m, o) in enumerate(zip(ms, obs, strict=True))]
    films = {f"b{i}": f for i, f in enumerate(fs)}
    assert score(squares, films)["verdict"] == "FAIL"

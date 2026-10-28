"""Tests for the single-layer film physics behind Gate 2 (castforecast/film.py)."""

import math

import numpy as np
import pytest

from castforecast.film import (
    LayerFilm,
    lightness,
    over,
    scaled,
    solve_film,
)


def test_over_is_the_single_layer_equation():
    # rho' = R + T^2 rho / (1 - R rho)
    assert over(0.2, 0.7, 0.5) == pytest.approx(0.2 + 0.49 * 0.5 / (1 - 0.1))
    assert over(0.0, 1.0, 0.37) == pytest.approx(0.37)  # no film
    assert over(0.3, 0.0, 0.9) == pytest.approx(0.3)  # opaque film hides the substrate


@pytest.mark.parametrize(("r", "t"), [(0.2, 0.7), (0.05, 0.9), (0.45, 0.4), (0.0, 0.8), (0.3, 0.0)])
def test_solve_recovers_a_known_film_from_black_and_white(r, t):
    black, white = 0.04, 0.86
    film = solve_film(black, over(r, t, black), white, over(r, t, white))
    assert film is not None
    assert film.r == pytest.approx(r, abs=1e-9)
    assert film.t == pytest.approx(t, abs=1e-9)


def test_solve_rejects_inadmissible_films():
    # Coated darker than bare on white but lighter on black beyond what any film allows.
    assert solve_film(0.04, 0.30, 0.86, 0.20) is None
    # Equal substrates carry no information.
    assert solve_film(0.5, 0.6, 0.5, 0.6) is None
    # A film must not create light: R + T <= 1.
    assert solve_film(0.04, 0.9, 0.86, 1.2) is None


def test_scaled_reproduces_the_film_at_unit_thickness():
    film = LayerFilm(0.2, 0.7)
    for f in (film, LayerFilm(0.05, 0.93), LayerFilm(0.4, 0.45)):
        s = scaled(f, 1.0)
        assert s.r == pytest.approx(f.r, abs=1e-9)
        assert s.t == pytest.approx(f.t, abs=1e-9)


def test_scaled_obeys_kubelka_layer_composition():
    # Two identical layers stacked must equal one layer of double thickness (Kubelka).
    f = LayerFilm(0.2, 0.7)
    r2 = f.r + f.t**2 * f.r / (1 - f.r * f.r)
    t2 = f.t**2 / (1 - f.r * f.r)
    d = scaled(f, 2.0)
    assert d.r == pytest.approx(r2, abs=1e-9)
    assert d.t == pytest.approx(t2, abs=1e-9)


def test_scaled_thin_and_thick_limits():
    f = LayerFilm(0.2, 0.7)
    thin = scaled(f, 1e-6)
    assert thin.r == pytest.approx(0.0, abs=1e-5) and thin.t == pytest.approx(1.0, abs=1e-5)
    thick = scaled(f, 200.0)
    assert thick.t == pytest.approx(0.0, abs=1e-9)
    assert 0 < thick.r < 1


def test_scaled_pure_absorber_and_opaque_film():
    a = scaled(LayerFilm(0.0, 0.81), 2.0)
    assert a.r == 0.0 and a.t == pytest.approx(0.81**2)
    o = scaled(LayerFilm(0.35, 0.0), 0.5)
    assert o.r == pytest.approx(0.35) and o.t == 0.0


def test_scaled_rejects_bad_thickness():
    with pytest.raises(ValueError):
        scaled(LayerFilm(0.2, 0.7), 0.0)


def test_lightness_matches_cie_reference_points():
    assert lightness(np.array([1.0, 1.0, 1.0])) == pytest.approx(100.0)
    assert lightness(np.array([0.0, 0.0, 0.0])) == pytest.approx(0.0)
    # Y = 0.18 is L* 49.5 (CIE 1976).
    assert lightness(np.array([0.18, 0.18, 0.18])) == pytest.approx(49.496, abs=1e-3)
    # Below the CIE threshold the linear branch applies.
    y = 0.005
    assert lightness(np.array([y, y, y])) == pytest.approx(903.2962963 * y, rel=1e-6)


def test_whitening_rises_with_film_strength():
    skin = 0.25
    weak = over(0.05, 0.92, skin)
    strong = over(0.15, 0.8, skin)
    assert skin < weak < strong
    assert not math.isnan(strong)

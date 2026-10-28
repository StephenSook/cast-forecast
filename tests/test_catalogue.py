"""Tests for turning a measured film into catalogue render and whitening values (castforecast/catalogue.py)."""

import numpy as np
import pytest

from castforecast.catalogue import MAX_BLEND, render_params, whitening_band
from castforecast.film import LayerFilm
from castforecast.gate2 import predict_film


def film3(r, t2):
    f = LayerFilm(r, float(np.sqrt(t2)))
    return (f, f, f)


def test_blend_is_one_minus_transmitted_light_and_palette_is_r_over_blend():
    got = render_params(film3(0.1, 0.8))
    assert got["blend"] == pytest.approx(0.2)
    assert got["paletteHex"] == "#bcbcbc"  # linear 0.5 encoded to sRGB
    assert got["reachable"] is True


def test_a_blend_beyond_the_k1b_curve_is_flagged_unreachable():
    assert MAX_BLEND == pytest.approx(0.3545024830997824)
    assert render_params(film3(0.3, 0.5))["reachable"] is False


def test_a_non_absorbing_film_stays_below_white():
    # r + t = 1 is the brightest accepted film: palette r / (1 - t^2) = 1 / (2 - r) < 1.
    assert render_params(film3(0.5, 0.25))["paletteHex"] == "#d5d5d5"


def test_whitening_band_spans_the_paper_sensitivity_runs():
    base = np.array([0.3, 0.2, 0.15])
    films = {0.80: film3(0.08, 0.83), 0.88: film3(0.1, 0.8), 0.95: film3(0.12, 0.76)}
    band = whitening_band(films, base)
    want = predict_film(films[0.88], 1.0, base)
    assert band["value"] == pytest.approx(want)
    assert band["low"] <= band["value"] <= band["high"]
    assert band["unit"] == "L*"


def test_whitening_band_is_none_if_any_run_has_no_usable_film():
    base = np.array([0.3, 0.2, 0.15])
    assert whitening_band({0.80: None, 0.88: film3(0.1, 0.8), 0.95: film3(0.1, 0.8)}, base) is None

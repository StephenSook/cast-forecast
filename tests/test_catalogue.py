"""Tests for turning a measured film into catalogue render and whitening values (castforecast/catalogue.py)."""

import numpy as np
import pytest

from castforecast.catalogue import (
    MAX_BLEND,
    MAX_RENDER_ERROR,
    REFERENCE_SKINS,
    render_params,
    whitening_band,
)
from castforecast.film import LayerFilm, lightness, over
from castforecast.gate2 import predict_film


def film3(r, t2):
    f = LayerFilm(r, float(np.sqrt(t2)))
    return (f, f, f)


def _hex_to_linear(h):
    srgb = np.array([int(h[i : i + 2], 16) for i in (1, 3, 5)]) / 255.0
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)


def _rendered_vs_film(film, params):
    """Worst L* gap, over the reference skins, between the render the values describe and the film."""
    a, p = params["blend"], _hex_to_linear(params["paletteHex"])
    gaps = []
    for s in REFERENCE_SKINS:
        rendered = (1 - a) * s + a * p
        filmed = np.array([over(f.r, f.t, float(s[c])) for c, f in enumerate(film)])
        gaps.append(abs(lightness(rendered) - lightness(filmed)))
    return max(gaps)


def test_a_grey_film_renders_within_the_bound_on_every_reference_skin():
    film = film3(0.1, 0.8)
    got = render_params(film)
    assert got["reachable"] is True
    assert got["render_error"] <= MAX_RENDER_ERROR
    assert _rendered_vs_film(film, got) <= MAX_RENDER_ERROR + 0.05  # hex rounding


def test_a_blend_beyond_the_k1b_curve_is_flagged_unreachable():
    assert MAX_BLEND == pytest.approx(0.3545024830997824)
    got = render_params(film3(0.3, 0.5))
    assert got["blend"] > MAX_BLEND and got["reachable"] is False


def test_a_film_one_blend_cannot_copy_is_refused():
    # Codex review r2: averaging T^2 rendered this blue-scattering film as -1.39 L* where the film
    # gives +2.81 L*, and called it reachable.
    film = (LayerFilm(0.02, 0.98), LayerFilm(0.02, 0.98), LayerFilm(0.30, 0.70))
    got = render_params(film)
    assert got["render_error"] > MAX_RENDER_ERROR
    assert got["reachable"] is False


def test_reference_skins_are_real_colours():
    assert REFERENCE_SKINS.shape == (5, 3)
    assert ((REFERENCE_SKINS > 0) & (REFERENCE_SKINS < 1)).all()
    assert [round(lightness(s)) for s in REFERENCE_SKINS] == [35, 45, 55, 65, 75]


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


def test_the_web_fixture_is_what_render_entry_writes_today():
    # web/tests/unit/routes.render.test.ts feeds this fixture through the loader and the render route.
    import json
    from pathlib import Path

    from castforecast.catalogue import render_entry

    fixture = (
        Path(__file__).resolve().parent.parent / "web/tests/fixtures/catalogue-from-python.json"
    )
    entry = json.loads(fixture.read_text())["bottles"][0]
    film = (LayerFilm(0.02, 0.98), LayerFilm(0.02, 0.98), LayerFilm(0.30, 0.70))
    want = render_entry(film)
    assert entry["render"]["paletteHex"] == want["paletteHex"]
    assert entry["render"]["blend"] == pytest.approx(want["blend"], abs=1e-12)
    assert entry["render"]["errorL"] == pytest.approx(want["errorL"], abs=1e-12)
    assert set(entry["render"]) == {"paletteHex", "blend", "errorL"}
    assert want["errorL"] > MAX_RENDER_ERROR

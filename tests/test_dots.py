"""Tests for snapping a rough dot position to the dot's centre (castforecast/dots.py)."""

import numpy as np
import pytest

from castforecast.dots import luminance, snap


def _disk(img, cx, cy, r, value):
    yy, xx = np.mgrid[: img.shape[0], : img.shape[1]]
    img[(xx - cx) ** 2 + (yy - cy) ** 2 <= r * r] = value


def test_a_dark_dot_on_skin_snaps_to_its_centre_despite_a_rough_seed():
    rng = np.random.default_rng(7)
    img = 0.35 + rng.normal(0, 0.01, (300, 300))
    _disk(img, 140.3, 160.7, 10, 0.08)
    x, y = snap(img, (165, 140), dark=True)
    assert (x, y) == pytest.approx((140.3, 160.7), abs=0.5)


def test_a_white_dot_on_the_black_card_snaps_when_dark_is_false():
    img = np.full((300, 300), 0.03)
    _disk(img, 90, 200, 8, 0.7)
    assert snap(img, (100, 190), dark=False) == pytest.approx((90, 200), abs=0.5)


def test_the_dot_nearest_the_seed_wins():
    img = np.full((300, 300), 0.5)
    _disk(img, 120, 150, 8, 0.05)
    _disk(img, 170, 150, 8, 0.05)
    assert snap(img, (160, 150), dark=True) == pytest.approx((170, 150), abs=0.5)


def test_no_dot_in_reach_is_refused():
    rng = np.random.default_rng(1)
    img = 0.5 + rng.normal(0, 0.01, (300, 300))
    with pytest.raises(ValueError):
        snap(img, (150, 150), dark=True)


def test_luminance_weights_linear_srgb():
    rgb = np.zeros((1, 1, 3))
    rgb[0, 0] = [1.0, 0.0, 0.0]
    assert luminance(rgb)[0, 0] == pytest.approx(0.2126)

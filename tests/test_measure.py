"""Tests for Gate 2 measurement from decoded frames (castforecast/measure.py)."""

import numpy as np
import pytest

from castforecast.film import lightness, over
from castforecast.measure import (
    Bottle,
    arm_result,
    card_film,
    forearm_bottles,
    frame_regions,
    reflectance,
)
from castforecast.raw import Decoded

PX = 40.0  # pixels per cm in the synthetic frames
SHAPE = (800, 1200)


def _corners(x0, y0, w_cm, h_cm):
    w, h = w_cm * PX, h_cm * PX
    return [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]


def _paint(img, x0, y0, w_cm, h_cm, rgb):
    img[int(y0) : int(y0 + h_cm * PX), int(x0) : int(x0 + w_cm * PX)] = rgb


def _card_frame(bare, coated, paper=0.5, clip_window=False):
    """A 4 x 5 cm window at (200, 200) on a card painted `bare`, coated with `coated`."""
    img = np.zeros((*SHAPE, 3), np.float32)
    _paint(img, 600, 100, 8, 6, paper)
    _paint(img, 140, 60, 6.5, 12, bare)  # the card, bigger than window plus both bare strips
    _paint(img, 200, 200, 4, 5, coated)
    clipped = np.zeros(SHAPE, bool)
    if clip_window:
        clipped[200:400, 200:360] = True
    return Decoded(img, clipped, {}), _corners(600, 100, 8, 6), {"win": _corners(200, 200, 4, 5)}


def test_reflectance_scales_by_paper_and_its_assumed_reflectance():
    got = reflectance(np.array([0.1, 0.2, 0.4]), np.array([0.5, 0.5, 0.8]), paper_r=0.88)
    np.testing.assert_allclose(got, [0.176, 0.352, 0.44])


def test_frame_regions_measures_treated_and_bare_against_paper():
    d, paper, wins = _card_frame(bare=[0.05, 0.05, 0.05], coated=[0.2, 0.25, 0.3])
    got = frame_regions(d, paper, wins, card=True, paper_r=0.88)
    np.testing.assert_allclose(
        got["win"]["treated"], np.array([0.2, 0.25, 0.3]) / 0.5 * 0.88, rtol=1e-6
    )
    np.testing.assert_allclose(got["win"]["bare"], [0.088] * 3, rtol=1e-6)


def test_an_unusable_region_is_none_and_missing_dots_are_reported():
    d, paper, wins = _card_frame(bare=[0.05] * 3, coated=[0.2] * 3, clip_window=True)
    wins["gone"] = _corners(200, 200, 4, 5)[:3]
    got = frame_regions(d, paper, wins, card=True, paper_r=0.88)
    assert got["win"]["treated"] is None
    assert got["gone"] == {"error": "need exactly four dots"}


def test_card_film_recovers_a_known_film_from_two_cards():
    r, t = (0.12, 0.2, 0.3), (0.8, 0.7, 0.55)
    bb, bw = 0.04, 0.85
    black = (np.full(3, bb), np.array([over(ri, ti, bb) for ri, ti in zip(r, t, strict=True)]))
    white = (np.full(3, bw), np.array([over(ri, ti, bw) for ri, ti in zip(r, t, strict=True)]))
    film = card_film(black, white)
    np.testing.assert_allclose([f.r for f in film], r, atol=1e-9)
    np.testing.assert_allclose([f.t for f in film], t, atol=1e-9)


def test_one_rejected_channel_or_a_missing_region_makes_the_film_unusable():
    black = (np.full(3, 0.04), np.array([0.2, 0.2, 0.2]))
    white = (np.full(3, 0.85), np.array([0.6, 0.6, 1.4]))  # blue: coated white above any film
    assert card_film(black, white) is None
    assert card_film((None, black[1]), white) is None


def _arm(base_u, t15_u, base_a, t15_a):
    as_rgb = lambda l_star: np.full(3, ((l_star + 16) / 116) ** 3)
    base = {"A": {"treated": as_rgb(base_a)}, "U": {"treated": as_rgb(base_u)}}
    t15 = {"A": {"treated": as_rgb(t15_a)}, "U": {"treated": as_rgb(t15_u)}}
    return base, t15


def test_arm_whitening_is_corrected_by_the_untreated_square():
    base, t15 = _arm(base_u=50.0, t15_u=51.0, base_a=48.0, t15_a=56.0)
    res = arm_result(base, t15, treated=("A",))
    assert res["valid"] is True
    assert res["obs"]["A"] == pytest.approx(7.0)
    assert res["drift"] == pytest.approx(1.0)
    assert lightness(res["base"]["A"]) == pytest.approx(48.0)


def test_drift_over_1_5_or_an_unusable_region_invalidates_the_arm():
    base, t15 = _arm(base_u=50.0, t15_u=51.6, base_a=48.0, t15_a=56.0)
    res = arm_result(base, t15, treated=("A",))
    assert res["valid"] is False and "drift" in res["reasons"][0]
    assert "obs" not in res  # validity is decided before any whitening value exists

    base, t15 = _arm(base_u=50.0, t15_u=50.0, base_a=48.0, t15_a=56.0)
    t15["A"] = {"error": "need exactly four dots"}
    res = arm_result(base, t15, treated=("A",))
    assert res["valid"] is False and "A at T15" in res["reasons"][0]


def test_forearm_bottles_follow_the_committed_rule():
    bottles = [
        Bottle("OWN2", 0.0),
        Bottle("HOME9", 0.0),
        Bottle("OWN1", 6.3),
        Bottle("SAM1", 20.0),
        Bottle("SAM2", 12.0),
        Bottle("SAM3", 12.0),
    ]
    # one control (code order), then the highest m, ties to the code that sorts first
    assert forearm_bottles(bottles) == ["HOME9", "SAM1", "SAM2", "SAM3"]
    assert forearm_bottles([b for b in bottles if b.m > 0]) == ["SAM1", "SAM2", "SAM3", "OWN1"]

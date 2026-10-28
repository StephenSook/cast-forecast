"""Tests for Gate 2 regions from corner dots (castforecast/regions.py, Amendment 1 rule 1)."""

import math

import numpy as np
import pytest

from castforecast.regions import bare, paper, polygon_mask, treated, window_frame

PX = 100.0  # pixels per cm in the synthetic frames
SHAPE = (1400, 1400)


def _rect(x0, y0, w_cm, h_cm, angle_deg=0.0):
    """Corners of a w x h cm rectangle at (x0, y0), rotated about its centre, in pixels."""
    w, h = w_cm * PX, h_cm * PX
    pts = np.array([[0, 0], [w, 0], [w, h], [0, h]], float) - [w / 2, h / 2]
    a = math.radians(angle_deg)
    rot = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
    return pts @ rot.T + [x0 + w / 2, y0 + h / 2]


def _area_cm2(poly):
    return polygon_mask(poly, SHAPE).sum() / PX**2


def _ring(perimeter_cm):
    """Area of a one-pixel ring around the perimeter: edges on pixel centres count once more."""
    return perimeter_cm / PX


def _centroid(poly):
    ys, xs = np.nonzero(polygon_mask(poly, SHAPE))
    return np.array([xs.mean(), ys.mean()])


@pytest.mark.parametrize("angle", [0.0, 30.0, 90.0])
def test_treated_region_is_the_window_shrunk_5_mm(angle):
    dots = _rect(400, 400, 4, 5, angle)[[2, 0, 3, 1]]  # any order
    assert _area_cm2(treated(dots)) == pytest.approx(3.0 * 4.0, abs=_ring(14.0))
    np.testing.assert_allclose(_centroid(treated(dots)), dots.mean(axis=0), atol=1.0)


def test_bare_regions_sit_beyond_the_short_edges():
    dots = _rect(400, 400, 4, 5)  # short edges are the top and bottom
    a, b = sorted(bare(dots), key=lambda p: _centroid(p)[1])
    for poly in (a, b):
        assert _area_cm2(poly) == pytest.approx(3.0 * 1.5, abs=_ring(9.0))
        assert not (polygon_mask(poly, SHAPE) & polygon_mask(dots, SHAPE)).any()
    cx = 400 + 2 * PX
    np.testing.assert_allclose(_centroid(a), [cx, 400 - 1.25 * PX], atol=1.0)
    np.testing.assert_allclose(_centroid(b), [cx, 400 + 5 * PX + 1.25 * PX], atol=1.0)


def test_bare_regions_follow_the_window_when_it_lies_sideways():
    dots = _rect(400, 400, 5, 4)  # long edge horizontal, so bare strips go left and right
    a, b = sorted(bare(dots), key=lambda p: _centroid(p)[0])
    np.testing.assert_allclose(_centroid(a), [400 - 1.25 * PX, 400 + 2 * PX], atol=1.0)
    np.testing.assert_allclose(_centroid(b), [400 + 5 * PX + 1.25 * PX, 400 + 2 * PX], atol=1.0)


def test_paper_region_is_the_central_half_by_area():
    corners = _rect(100, 100, 10, 8)[[1, 3, 0, 2]]
    poly = paper(corners)
    assert _area_cm2(poly) == pytest.approx(40.0, abs=_ring(25.5))
    np.testing.assert_allclose(_centroid(poly), [600, 500], atol=1.0)


@pytest.mark.parametrize(
    "dots",
    [
        _rect(400, 400, 4.5, 4.5),  # square: the 4 cm edge cannot be told apart
        _rect(400, 400, 2, 5),  # far too long and thin for a 4 x 5 cm window
        np.array([[0, 0], [100, 0], [200, 0], [300, 0]], float),  # collinear
        _rect(400, 400, 4, 5)[:3],  # a dot missing
    ],
)
def test_dots_that_cannot_be_a_window_are_refused(dots):
    with pytest.raises(ValueError):
        window_frame(dots)


def test_a_region_that_leaves_the_image_is_refused():
    with pytest.raises(ValueError, match="leaves the image"):
        polygon_mask(_rect(1300, 1300, 4, 5), SHAPE)

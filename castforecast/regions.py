"""Gate 2 measurement regions from corner dots (docs/gates/gate2-preregistration.md, Amendment 1).

Before any product goes on, every 4 cm x 5 cm window gets four small dots, each touching a corner
from outside; a dot's centre is taken to sit `DOT_OFFSET` (1 mm) outside both edges at its corner.
The dots are listed in order around the window, starting at a corner, with the first edge a 4 cm
edge; that labelling, not image lengths, says which edges are which (foreshortening could swap
them), and the image lengths must agree with it. A projective map sends the window's own
centimetre frame (u along the 4 cm edge, v along the 5 cm edge) onto the dots, and every region
is drawn in that frame, so nothing is placed by eye.

- treated square, and the untreated square U: the window shrunk 5 mm on every side (3 x 4 cm);
- bare card: two 3 x 1.5 cm rectangles beyond the window's two 4 cm edges, each starting 5 mm out;
- paper: the central half of the sheet by area, from the sheet's four corners.

Dots that cannot be this window (not four, not convex in the given order, the labelled 4 cm edges
not the shorter pair, or edge lengths too far from 4:5) raise ValueError, and so does a region
that leaves the image: the square is then unusable.
"""

from __future__ import annotations

import math

import numpy as np

WINDOW = (4.0, 5.0)  # cm: the short edge, the long edge
DOT_OFFSET = 0.1  # cm: a dot's centre outside each window edge at its corner
INSET = 0.5  # cm
BARE = (3.0, 1.5)  # cm: along the short edge, along the long edge
BARE_GAP = 0.5  # cm beyond the window edge
PAPER_SIDE = math.sqrt(0.5)  # central half by area
RATIO_RANGE = (0.65, 0.95)  # short / long edge length a 4 x 5 window can show (0.8 nominal)


def _four(pts) -> np.ndarray:
    p = np.asarray(pts, float)
    if p.shape != (4, 2) or not np.isfinite(p).all():
        raise ValueError("need exactly four dots")
    return p


def _convex(p: np.ndarray) -> np.ndarray:
    """`p` unchanged if, in this order, it is a convex quadrilateral; ValueError otherwise."""
    e = np.roll(p, -1, axis=0) - p
    nxt = np.roll(e, -1, axis=0)
    cross = e[:, 0] * nxt[:, 1] - e[:, 1] * nxt[:, 0]
    if not (np.all(cross > 1e-9) or np.all(cross < -1e-9)):
        raise ValueError("dots are not a convex quadrilateral in the order given")
    return p


def _sorted_quad(pts) -> np.ndarray:
    """The four points in order around their centre (for the paper, whose sides are symmetric)."""
    p = _four(pts)
    c = p.mean(axis=0)
    return _convex(p[np.argsort(np.arctan2(p[:, 1] - c[1], p[:, 0] - c[0]))])


def _homography(src, dst) -> np.ndarray:
    """The 3 x 3 projective map taking the four src points to the four dst points."""
    a, b = [], []
    for (x, y), (u, v) in zip(src, dst, strict=True):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        b.append(u)
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        b.append(v)
    return np.append(np.linalg.solve(np.array(a), np.array(b)), 1.0).reshape(3, 3)


def window_frame(dots) -> np.ndarray:
    """Map from the window's cm frame (u along the 4 cm edge, v along the 5 cm edge) to pixels.

    `dots` go around the window in order, the first edge (dot 1 to dot 2) a 4 cm edge.
    """
    p = _convex(_four(dots))
    lens = np.linalg.norm(np.roll(p, -1, axis=0) - p, axis=1)
    short, long = lens[0] + lens[2], lens[1] + lens[3]
    if short >= long:
        raise ValueError("the edges labelled 4 cm are not the shorter pair in the image")
    if not RATIO_RANGE[0] <= short / long <= RATIO_RANGE[1]:
        raise ValueError(f"dots do not look like a 4 x 5 cm window (edge ratio {short / long:.2f})")
    w, h, o = *WINDOW, DOT_OFFSET
    return _homography([(-o, -o), (w + o, -o), (w + o, h + o), (-o, h + o)], p)


def _box(hm: np.ndarray, u0: float, u1: float, v0: float, v1: float) -> np.ndarray:
    q = np.array([[u0, v0, 1], [u1, v0, 1], [u1, v1, 1], [u0, v1, 1]], float) @ hm.T
    return q[:, :2] / q[:, 2:]


def treated(dots) -> np.ndarray:
    """The measured area of a treated square, or of the untreated square U."""
    w, h = WINDOW
    return _box(window_frame(dots), INSET, w - INSET, INSET, h - INSET)


def bare(dots) -> list[np.ndarray]:
    """The two bare-card rectangles next to a card window."""
    hm = window_frame(dots)
    w, h = WINDOW
    bw, bh = BARE
    u0 = (w - bw) / 2
    return [
        _box(hm, u0, u0 + bw, -BARE_GAP - bh, -BARE_GAP),
        _box(hm, u0, u0 + bw, h + BARE_GAP, h + BARE_GAP + bh),
    ]


def paper(corners) -> np.ndarray:
    """The central half (by area) of the white paper, from its four corners."""
    hm = _homography([(0, 0), (1, 0), (1, 1), (0, 1)], _sorted_quad(corners))
    c = (1 - PAPER_SIDE) / 2
    return _box(hm, c, 1 - c, c, 1 - c)


def polygon_mask(poly, shape: tuple[int, int]) -> np.ndarray:
    """Pixels whose centre (x, y) lies in the convex polygon; ValueError if it leaves the image."""
    poly = np.asarray(poly, float)
    rows, cols = shape
    (x0, y0), (x1, y1) = np.floor(poly.min(axis=0)), np.ceil(poly.max(axis=0))
    if x0 < 0 or y0 < 0 or x1 > cols - 1 or y1 > rows - 1:
        raise ValueError("region leaves the image")
    x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
    ys, xs = np.mgrid[y0 : y1 + 1, x0 : x1 + 1]
    e = np.roll(poly, -1, axis=0) - poly
    orient = np.sign(
        np.sum(poly[:, 0] * np.roll(poly[:, 1], -1) - np.roll(poly[:, 0], -1) * poly[:, 1])
    )
    inside = np.ones(xs.shape, bool)
    for (ax, ay), (ex, ey) in zip(poly, e, strict=True):
        inside &= orient * (ex * (ys - ay) - ey * (xs - ax)) >= 0
    out = np.zeros(shape, bool)
    out[y0 : y1 + 1, x0 : x1 + 1] = inside
    return out

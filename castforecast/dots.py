"""Snap a rough corner-dot position to the dot's centre (Gate 2 Amendment 1 rule 1).

The analyst gives only a rough position per dot; this module finds the dot itself, so where a
region lands never depends on a hand placement. Inside a square patch around the seed, Otsu's
threshold splits dot from background; the dot is the connected component, within the size and
contrast limits, whose centre is nearest the seed. No such component means the dot is not found,
and the square is unusable.

The three limits below are PROVISIONAL: they are set from the first real frames (looking only at
the dots, before any reflectance or L* is computed), and the values used are reported with the
Gate 2 results.
"""

from __future__ import annotations

import cv2
import numpy as np

RADIUS = 60  # px: half-width of the search patch around the seed
AREA = (30, 3000)  # px: a dot is a component of this many pixels
MIN_CONTRAST = 0.25  # |dot - background| / background


def luminance(rgb: np.ndarray) -> np.ndarray:
    """Relative luminance Y of linear sRGB, per pixel."""
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def snap(lum: np.ndarray, seed, dark: bool, radius: int = RADIUS) -> tuple[float, float]:
    """The (x, y) centre of the dot nearest `seed`; ValueError when no dot is found."""
    sx, sy = (int(np.rint(v)) for v in seed)
    y0, x0 = max(sy - radius, 0), max(sx - radius, 0)
    patch = np.asarray(lum[y0 : sy + radius + 1, x0 : sx + radius + 1], float)
    if patch.size == 0:
        raise ValueError("seed is outside the image")
    lo, hi = float(patch.min()), float(patch.max())
    if hi - lo <= 0:
        raise ValueError("no dot near the seed (flat patch)")
    u8 = np.round((patch - lo) / (hi - lo) * 255).astype(np.uint8)
    mode = cv2.THRESH_BINARY_INV if dark else cv2.THRESH_BINARY
    _, fg = cv2.threshold(u8, 0, 255, mode | cv2.THRESH_OTSU)
    n, labels, stats, cents = cv2.connectedComponentsWithStats(fg, connectivity=8)
    background = float(np.median(patch[fg == 0])) if (fg == 0).any() else float("nan")
    best, best_d = None, np.inf
    for i in range(1, n):
        if not AREA[0] <= stats[i, cv2.CC_STAT_AREA] <= AREA[1]:
            continue
        level = float(patch[labels == i].mean())
        if not abs(level - background) >= MIN_CONTRAST * max(background, 1e-6):
            continue
        cx, cy = cents[i]
        d = (cx + x0 - seed[0]) ** 2 + (cy + y0 - seed[1]) ** 2
        if d < best_d:
            best, best_d = (float(cx + x0), float(cy + y0)), d
    if best is None:
        raise ValueError("no dot near the seed")
    return best

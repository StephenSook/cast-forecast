"""Snap a rough corner-dot position to the dot's centre (Gate 2 Amendment 1 rule 1).

The analyst gives only a rough position per dot; this module finds the dot itself, so where a
region lands never depends on a hand placement. Inside a square patch around the seed, Otsu's
threshold splits dot from background. A candidate must be a whole, roughly round blob: within the
size limits, not touching the patch edge (a cut-off dot or a line running out of the patch), with
a compact bounding box, and far enough from the background level. The dot is the candidate whose
centre is nearest the seed; if another candidate is nearly as near, the dot is ambiguous. No dot,
or an ambiguous one, means the dot is not found, and the square is unusable.

The limits below are PROVISIONAL: they are set from the first real frames (looking only at the
dots, before any reflectance or L* is computed), and the values used are reported with the Gate 2
results.
"""

from __future__ import annotations

import cv2
import numpy as np

RADIUS = 60  # px: half-width of the search patch around the seed
AREA = (30, 3000)  # px: a dot is a component of this many pixels
MIN_CONTRAST = 0.25  # |dot - background| / background
MAX_ASPECT = 1.6  # longer / shorter side of the blob's bounding box (a disc is 1)
MIN_FILL = 0.6  # blob area / bounding-box area (a disc is 0.785)
AMBIGUOUS = (2.0, 5.0)  # a second candidate within 2 x the nearest distance + 5 px is too close


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
    rows, cols = patch.shape
    found = []
    for i in range(1, n):
        x, y, w, h, area = (int(v) for v in stats[i, :5])
        if not AREA[0] <= area <= AREA[1]:
            continue
        if x == 0 or y == 0 or x + w == cols or y + h == rows:
            continue
        if max(w, h) > MAX_ASPECT * min(w, h) or area < MIN_FILL * w * h:
            continue
        level = float(patch[labels == i].mean())
        if not abs(level - background) >= MIN_CONTRAST * max(background, 1e-6):
            continue
        cx, cy = float(cents[i][0] + x0), float(cents[i][1] + y0)
        found.append((float(np.hypot(cx - seed[0], cy - seed[1])), cx, cy))
    if not found:
        raise ValueError("no dot near the seed")
    found.sort()
    if len(found) > 1 and found[1][0] <= AMBIGUOUS[0] * found[0][0] + AMBIGUOUS[1]:
        raise ValueError("two dots near the seed")
    return found[0][1], found[0][2]

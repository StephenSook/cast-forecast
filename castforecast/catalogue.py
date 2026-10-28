"""Catalogue values for one bottle from its measured film (web/src/lib/catalogue.ts schema).

Render: YouCam's makeup render mixes a palette colour into the skin, out = (1 - a) rho + a P.
A film over skin gives rho' = R + T^2 rho / (1 - R rho), which is close to that mix with
a = 1 - T^2 and P = R / a when R rho is small. One blend serves all three channels, so a uses
the mean of T^2; the palette is clipped to [0, 1]. This is an approximation, and every render
built from it is labelled as one. A blend above the K1b curve's top (colorIntensity 100) cannot
be rendered at full strength and is flagged unreachable; the render route refuses those bottles.

Whitening: the film's predicted whitening on a stated reference skin at the card dose, with low
and high from the paper-reflectance sensitivity runs (0.80 and 0.95), value from 0.88.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from castforecast.color import _encode
from castforecast.gate2 import Film3, predict_film

_K1B = Path(__file__).resolve().parent.parent / "docs" / "gates" / "k1b-results.json"
MAX_BLEND = float(json.loads(_K1B.read_text())["g100"])
PAPER_SCALES = (0.80, 0.88, 0.95)


def _hex(linear: np.ndarray) -> str:
    srgb = np.clip(np.rint(_encode(np.clip(linear, 0.0, 1.0)) * 255.0), 0, 255).astype(int)
    return "#" + "".join(f"{v:02x}" for v in srgb)


def render_params(film: Film3) -> dict:
    """paletteHex and blend for the VTO render, and whether the K1b curve can reach the blend."""
    blend = 1.0 - float(np.mean([f.t * f.t for f in film]))
    if blend <= 1e-6:
        return {"paletteHex": "#ffffff", "blend": 0.0, "reachable": True}
    palette = np.array([f.r for f in film]) / blend
    return {"paletteHex": _hex(palette), "blend": blend, "reachable": blend <= MAX_BLEND}


def whitening_band(films: dict[float, Film3 | None], base: np.ndarray) -> dict | None:
    """Predicted whitening (L*) on `base` at the card dose; None unless every paper scale has a film."""
    if any(films.get(s) is None for s in PAPER_SCALES):
        return None
    vals = {s: predict_film(films[s], 1.0, base) for s in PAPER_SCALES}
    return {
        "value": vals[0.88],
        "low": min(vals.values()),
        "high": max(vals.values()),
        "unit": "L*",
    }

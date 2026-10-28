"""Catalogue values for one bottle from its measured film (web/src/lib/catalogue.ts schema).

Render: YouCam's makeup render mixes a palette colour into the skin, out = (1 - a) rho + a P, one
blend a for all channels. A film over skin gives rho' = R + T^2 rho / (1 - R rho) per channel,
which a single blend cannot always copy (a film that scatters only blue, for instance). So a and
P are fitted by least squares to the film's output on a fixed set of reference skins (CIELAB L*
35 to 75, a* 14, b* 18), with 0 <= a <= 1 and 0 <= P <= 1. The error is then measured on what
YouCam would actually be sent: the palette rounded to its #RRGGBB hex, and the blend the K1b curve
shows at the whole colorIntensity the render route picks for a (the same inverse, ported to
web/src/lib/curve.ts). The render is usable only when, on every reference skin, its L* is within
`MAX_RENDER_ERROR` of the film's; otherwise, or when the blend is above the top of the K1b curve
(colorIntensity 100), the bottle is flagged unreachable and the render route refuses it. Every
render built from these values is labelled an approximation.

Whitening: the film's predicted whitening on a stated reference skin at the card dose, with low
and high from the paper-reflectance sensitivity runs (0.80 and 0.95), value from 0.88.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path

import numpy as np

from castforecast.color import _decode, _encode
from castforecast.film import lightness, over
from castforecast.gate2 import Film3, predict_film
from castforecast.k1_render import coverage_for_alpha

with warnings.catch_warnings():
    warnings.filterwarnings("ignore", message=r".*SciPy.*related API features")
    import colour

_K1B = Path(__file__).resolve().parent.parent / "docs" / "gates" / "k1b-results.json"
_K1B_RESULTS = json.loads(_K1B.read_text())
MAX_BLEND = float(_K1B_RESULTS["g100"])
K1B_CURVE = {
    int(k): float(v) for k, v in _K1B_RESULTS["fit"]["g"].items()
}  # colorIntensity -> blend
PAPER_SCALES = (0.80, 0.88, 0.95)
MAX_RENDER_ERROR = 1.0  # L*, render against film on any reference skin
REFERENCE_SKIN_LAB = tuple((float(lum), 14.0, 18.0) for lum in (35, 45, 55, 65, 75))
REFERENCE_SKINS = np.array(
    [
        colour.XYZ_to_sRGB(colour.Lab_to_XYZ(np.array(lab)), apply_cctf_encoding=False)
        for lab in REFERENCE_SKIN_LAB
    ]
)


def _hex(linear: np.ndarray) -> str:
    srgb = np.clip(np.rint(_encode(np.clip(linear, 0.0, 1.0)) * 255.0), 0, 255).astype(int)
    return "#" + "".join(f"{v:02x}" for v in srgb)


def _fit(target: np.ndarray, rho: np.ndarray) -> tuple[float, np.ndarray]:
    """Least-squares (a, q = a P) for target = (1 - a) rho + q, then a and P clamped to [0, 1]."""
    n = rho.shape[0]
    rows = np.zeros((n * 3, 4))
    rows[:, 0] = -rho.ravel()
    for c in range(3):
        rows[c::3, 1 + c] = 1.0
    sol, *_ = np.linalg.lstsq(rows, (target - rho).ravel(), rcond=None)
    a = float(np.clip(sol[0], 0.0, 1.0))
    q = np.clip((target - (1 - a) * rho).mean(axis=0), 0.0, a)
    return a, q


def _hex_linear(h: str) -> np.ndarray:
    return _decode(np.array([int(h[i : i + 2], 16) for i in (1, 3, 5)]) / 255.0)


def render_params(film: Film3) -> dict:
    """paletteHex and blend for the VTO render, the colorIntensity and shown blend the route will
    use, the worst L* error of that quantized render, and whether it is usable."""
    rho = REFERENCE_SKINS
    target = np.array([[over(f.r, f.t, float(s[c])) for c, f in enumerate(film)] for s in rho])
    a, q = _fit(target, rho)
    palette_hex = _hex(q / a if a > 1e-6 else np.ones(3))
    intensity, shown, on_curve = coverage_for_alpha(K1B_CURVE, a)
    rendered = (1 - shown) * rho + shown * _hex_linear(palette_hex)
    error = max(abs(lightness(rendered[i]) - lightness(target[i])) for i in range(len(rho)))
    return {
        "paletteHex": palette_hex,
        "blend": a,
        "colorIntensity": intensity,
        "shown_blend": shown,
        "render_error": float(error),
        "reachable": bool(on_curve and error <= MAX_RENDER_ERROR),
    }


def render_entry(film: Film3) -> dict:
    """The `render` object of a web catalogue entry (web/src/lib/catalogue.ts): palette, blend and
    the worst L* error, which the render route checks against its own bound before any paid call."""
    got = render_params(film)
    return {"paletteHex": got["paletteHex"], "blend": got["blend"], "errorL": got["render_error"]}


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

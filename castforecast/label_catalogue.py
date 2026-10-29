"""Catalogue entries for retail bottles, predicted from their FDA labels (web/src/lib/catalogue.ts).

Whitening: `label_model.predict` from the label's zinc oxide percentage, on a stated reference skin
(L* 55). Its band is the label model's error on the one differently formulated product in Gate 1
(2.35 L*), not its smaller error on the study's own formulations (1.61 L*), because retail bottles
are formulated differently too.

Render: YouCam's makeup render mixes a palette colour into the skin, out = (1 - a) rho + a P. The
palette is white, the colour K1b validated. The blend a is the one whose L* change best matches
the predicted whitening over skins of L* 45 to 65 (inside the study's range), and the error is
measured on what YouCam is actually sent: the blend the K1b curve shows at the whole
colorIntensity the render route picks. A render more than `MAX_RENDER_ERROR` from the prediction
on any of those skins, or a blend above the top of the K1b curve, is unreachable; the render route
refuses it, and `build` leaves such a bottle out. Every render is labelled an approximation.

    python -m castforecast.label_catalogue [labels_json] [out_json]
"""

from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

import numpy as np

from castforecast.catalogue import K1B_CURVE, MAX_RENDER_ERROR
from castforecast.k1_render import coverage_for_alpha
from castforecast.label_model import predict

with warnings.catch_warnings():
    warnings.filterwarnings("ignore", message=r".*SciPy.*related API features")
    import colour

ROOT = Path(__file__).resolve().parent.parent
LABELS = ROOT / "data" / "bottles" / "fda_labels.json"
OUT = ROOT / "web" / "src" / "data" / "bottles.json"
PALETTE = "#ffffff"
SKIN_LIGHTNESS = (45.0, 50.0, 55.0, 60.0, 65.0)
SKINS = np.array(
    [
        colour.XYZ_to_sRGB(
            colour.Lab_to_XYZ(np.array([lum, 14.0, 18.0])), apply_cctf_encoding=False
        )
        for lum in SKIN_LIGHTNESS
    ]
)
REFERENCE_L = 55.0
RETAIL_ERROR_L = 2.35  # Gate 1, label model on the differently formulated benchmark product
ALPHAS = np.linspace(0.0, 1.0, 10001)


def _lightness(rgb: np.ndarray) -> np.ndarray:
    """CIE L* of linear sRGB reflectance, over the last axis."""
    y = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    eps = (6.0 / 29.0) ** 3
    f = np.where(y > eps, np.cbrt(y), y / (3.0 * (6.0 / 29.0) ** 2) + 4.0 / 29.0)
    return 116.0 * f - 16.0


def _rendered(alpha: np.ndarray | float, skins: np.ndarray) -> np.ndarray:
    """L* change of each skin under a white render at blend alpha (alphas x skins)."""
    a = np.atleast_1d(alpha)[:, None, None]
    return _lightness((1.0 - a) * skins[None] + a) - _lightness(skins)[None]


def label_render(zinc_oxide_pct: float) -> dict:
    """Blend for a white render of this zinc oxide percentage, the colorIntensity and shown blend the
    route will use, the worst L* error of that render against the prediction, and whether it is usable."""
    target = np.array([predict(zinc_oxide_pct, lum) for lum in SKIN_LIGHTNESS])
    sse = ((_rendered(ALPHAS, SKINS) - target[None]) ** 2).sum(axis=1)
    blend = float(ALPHAS[int(np.argmin(sse))])
    intensity, shown, on_curve = coverage_for_alpha(K1B_CURVE, blend)
    error = float(np.abs(_rendered(shown, SKINS)[0] - target).max())
    return {
        "paletteHex": PALETTE,
        "blend": blend,
        "colorIntensity": intensity,
        "shown_blend": shown,
        "render_error": error,
        "reachable": bool(on_curve and error <= MAX_RENDER_ERROR),
    }


def entry(bottle: dict) -> dict:
    """One web catalogue entry from one pinned FDA label (data/bottles/fda_labels.json)."""
    zinc = float(bottle["zinc_oxide_pct"])
    render = label_render(zinc)
    value = predict(zinc, REFERENCE_L)
    eff = str(bottle["label_effective"])
    return {
        "id": bottle["id"],
        "name": bottle["name"],
        "brand": bottle["brand"],
        "upc": bottle["upc"],
        "filter": "mineral",
        "tinted": False,
        "render": {
            "paletteHex": render["paletteHex"],
            "blend": render["blend"],
            "errorL": render["render_error"],
        },
        "whitening": {
            "value": value,
            "low": value - RETAIL_ERROR_L,
            "high": value + RETAIL_ERROR_L,
            "unit": "L*",
        },
        "evidence": {
            "source": "fda-label",
            "setId": bottle["set_id"],
            "labelEffective": f"{eff[:4]}-{eff[4:6]}-{eff[6:8]}",
            "zincOxidePct": zinc,
        },
    }


def build(labels: Path = LABELS) -> tuple[dict, list[str]]:
    """The catalogue file, and the ids of bottles left out because their render is unreachable."""
    kept, left_out = [], []
    for bottle in json.loads(Path(labels).read_text())["bottles"]:
        e = entry(bottle)
        if label_render(float(bottle["zinc_oxide_pct"]))["reachable"]:
            kept.append(e)
        else:
            left_out.append(bottle["id"])
    return {"schemaVersion": 1, "bottles": kept}, left_out


def dumps(catalogue: dict) -> str:
    return json.dumps(catalogue, indent=2) + "\n"


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    labels = Path(argv[0]) if argv else LABELS
    out = Path(argv[1]) if len(argv) > 1 else OUT
    catalogue, left_out = build(labels)
    out.write_text(dumps(catalogue))
    print(
        f"wrote {out}: {len(catalogue['bottles'])} bottles; left out (unreachable render): {left_out or 'none'}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Catalogue entries for retail bottles, predicted from their FDA labels (web/src/lib/catalogue.ts).

Tones: the shopper picks the closest of five skin tones spanning the PLOS ONE 2025 study's range
(L* 65 lighter to L* 45 deeper; the study measured L* 43.8 to 68.4 and had no Dark ITA group).
Skin deeper than these gets no prediction: the model is never extrapolated.

Whitening: `label_model.predict` from the label's zinc oxide percentage, per tone. Its band is the
label model's error on the one differently formulated product in Gate 1 (2.35 L*), not its smaller
error on the study's own formulations (1.61 L*), because retail bottles are formulated differently.
The top-level whitening is the middle tone (L* 55), used where one number per bottle is shown.

Render, per tone: YouCam's makeup render mixes a palette colour into the skin, out = (1 - a) rho +
a P, with a white palette (the colour K1b validated). The render route sends a whole
colorIntensity, which the K1b curve turns into the blend actually shown, so each tone's render is
chosen among those whole intensities: the one whose shown blend lands closest to the prediction,
provided it is within `MAX_RENDER_ERROR`. The stored blend is that intensity's shown blend, so
the route's inverse gives back the same intensity. A tone with no such intensity has no render and
the route refuses it. Every render is labelled an approximation.

Two files, from the same entries: every kept label (data/bottles/fda_labels.json rows with no
`excluded` reason) goes to web/src/data/labels.json, which only the server reads, and the featured
ones also go to web/src/data/bottles.json, the short list the browser gets for its chips.

    python -m castforecast.label_catalogue [labels_json] [bottles_json] [all_labels_json]
"""

from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

import numpy as np

from castforecast.catalogue import K1B_CURVE, MAX_RENDER_ERROR, _hex
from castforecast.label_model import predict
from castforecast.label_set import CATEGORY_REASONS

with warnings.catch_warnings():
    warnings.filterwarnings("ignore", message=r".*SciPy.*related API features")
    import colour

ROOT = Path(__file__).resolve().parent.parent
LABELS = ROOT / "data" / "bottles" / "fda_labels.json"
OUT = ROOT / "web" / "src" / "data" / "bottles.json"
ALL_OUT = ROOT / "web" / "src" / "data" / "labels.json"
SCHEMA_VERSION = 2
PALETTE = "#ffffff"
TONES = (65.0, 60.0, 55.0, 50.0, 45.0)  # L*, lighter to deeper, inside the study's range
SKINS = np.array(
    [
        colour.XYZ_to_sRGB(
            colour.Lab_to_XYZ(np.array([lum, 14.0, 18.0])), apply_cctf_encoding=False
        )
        for lum in TONES
    ]
)
REFERENCE_L = 55.0
RETAIL_ERROR_L = 2.35  # Gate 1, label model on the differently formulated benchmark product
_KEYS = sorted(K1B_CURVE)
INTENSITIES = np.arange(0, 101)
SHOWN = np.interp(
    INTENSITIES, _KEYS, [K1B_CURVE[k] for k in _KEYS]
)  # blend shown at each whole intensity


def _lightness(rgb: np.ndarray) -> np.ndarray:
    """CIE L* of linear sRGB reflectance, over the last axis."""
    y = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    eps = (6.0 / 29.0) ** 3
    f = np.where(y > eps, np.cbrt(y), y / (3.0 * (6.0 / 29.0) ** 2) + 4.0 / 29.0)
    return 116.0 * f - 16.0


def _rendered(alpha: np.ndarray, skin: np.ndarray) -> np.ndarray:
    """L* change of one skin under a white render at each blend in `alpha`."""
    a = np.asarray(alpha)[:, None]
    return _lightness((1.0 - a) * skin[None] + a) - _lightness(skin)


def tone_render(zinc_oxide_pct: float, tone: float) -> dict | None:
    """The render for this tone as the route will send it, or None when no whole intensity is close enough."""
    skin = SKINS[TONES.index(tone)]
    errors = np.abs(_rendered(SHOWN, skin) - predict(zinc_oxide_pct, tone))
    if errors.min() > MAX_RENDER_ERROR:
        return None
    i = int(np.argmin(errors))
    return {
        "paletteHex": PALETTE,
        "blend": float(SHOWN[i]),
        "colorIntensity": int(INTENSITIES[i]),
        "errorL": float(errors[i]),
    }


def _whitening(zinc_oxide_pct: float, tone: float) -> dict:
    value = predict(zinc_oxide_pct, tone)
    return {
        "value": value,
        "low": value - RETAIL_ERROR_L,
        "high": value + RETAIL_ERROR_L,
        "unit": "L*",
    }


def entry(bottle: dict) -> dict:
    """One web catalogue entry from one kept FDA label (a data/bottles/fda_labels.json row)."""
    zinc = float(bottle["zinc_oxide_pct"])
    tones = []
    for tone in TONES:
        r = tone_render(zinc, tone)
        render = (
            None
            if r is None
            else {"paletteHex": r["paletteHex"], "blend": r["blend"], "errorL": r["errorL"]}
        )
        tones.append({"lStar": tone, "whitening": _whitening(zinc, tone), "render": render})
    eff = str(bottle["label_effective"])
    return {
        "id": bottle["id"],
        "name": bottle["name"],
        "brand": bottle["brand"],
        "upc": bottle["upc"],
        "upcs": list(bottle.get("upcs") or ([bottle["upc"]] if bottle["upc"] else [])),
        "featured": bool(bottle.get("featured")),
        "filter": "mineral",
        "tinted": bool(bottle.get("tinted")),
        "whitening": _whitening(zinc, REFERENCE_L),
        "tones": tones,
        "evidence": {
            "source": "fda-label",
            "setId": bottle["set_id"],
            "labelEffective": f"{eff[:4]}-{eff[4:6]}-{eff[6:8]}",
            "zincOxidePct": zinc,
        },
    }


def build(labels: Path = LABELS) -> tuple[dict, list[str]]:
    """The full catalogue (every kept label), and the ids of kept labels with no tone render.

    The data file already leaves those out (label_set's render_error rule is this one), so the list
    is empty unless the two have drifted. `leftOut` counts the labels the site names as left out."""
    doc = json.loads(Path(labels).read_text())
    kept, left_out = [], []
    for bottle in doc["labels"]:
        if bottle["excluded"] is not None:
            continue
        e = entry(bottle)
        (kept if any(t["render"] for t in e["tones"]) else left_out).append(e)
    tones = [{"lStar": t, "hex": _hex(s)} for t, s in zip(TONES, SKINS, strict=True)]
    counts = doc["counts"]
    catalogue = {
        "schemaVersion": SCHEMA_VERSION,
        "tones": tones,
        "leftOut": {r: counts[r] for r in CATEGORY_REASONS},
        "bottles": kept,
    }
    return catalogue, [b["id"] for b in left_out]


def featured(catalogue: dict) -> dict:
    """The browser's short list: the featured entries, in the shape bottles.json has always had."""
    return {
        "schemaVersion": catalogue["schemaVersion"],
        "tones": catalogue["tones"],
        "bottles": [b for b in catalogue["bottles"] if b["featured"]],
    }


# The fit's last bits differ between BLAS builds (a Mac, CI's Linux); no reading needs more places.
PUBLISHED_DECIMALS = 6


def _published(x):
    """`x` with every float rounded to `PUBLISHED_DECIMALS`, so the file is the same on every machine."""
    if isinstance(x, float):
        return round(x, PUBLISHED_DECIMALS)
    if isinstance(x, dict):
        return {k: _published(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_published(v) for v in x]
    return x


def dumps(catalogue: dict) -> str:
    return json.dumps(_published(catalogue), indent=2) + "\n"


def dumps_compact(catalogue: dict) -> str:
    """The full catalogue with one entry per line: small, and a refetch diffs bottle by bottle."""
    pub = _published(catalogue)
    head = json.dumps({k: v for k, v in pub.items() if k != "bottles"}, separators=(",", ":"))
    rows = ",\n".join(json.dumps(b, separators=(",", ":")) for b in pub["bottles"])
    return f'{head[:-1]},"bottles":[\n{rows}\n]}}\n'


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    labels = Path(argv[0]) if argv else LABELS
    out = Path(argv[1]) if len(argv) > 1 else OUT
    all_out = Path(argv[2]) if len(argv) > 2 else ALL_OUT
    catalogue, left_out = build(labels)
    out.write_text(dumps(featured(catalogue)))
    all_out.write_text(dumps_compact(catalogue))
    print(
        f"wrote {out} ({len(featured(catalogue)['bottles'])} featured) and {all_out} "
        f"({len(catalogue['bottles'])} bottles); no tone renders: {left_out or 'none'}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

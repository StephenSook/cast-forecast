"""Color math: sRGB to CIELAB (D65) and CIEDE2000, plus gain applied in linear light."""

from __future__ import annotations

import warnings

import numpy as np

with warnings.catch_warnings():
    # colour-science warns that optional SciPy is absent; nothing here needs it.
    warnings.simplefilter("ignore")
    import colour


def _to_unit(rgb: np.ndarray) -> np.ndarray:
    arr = np.asarray(rgb)
    if arr.dtype == np.uint8:
        return arr.astype(np.float64) / 255.0
    return arr.astype(np.float64)


def _decode(unit: np.ndarray) -> np.ndarray:
    return np.where(unit <= 0.04045, unit / 12.92, ((unit + 0.055) / 1.055) ** 2.4)


def _encode(linear: np.ndarray) -> np.ndarray:
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055)


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB (uint8 or 0 to 1 float, last axis = 3) to CIELAB under D65."""
    xyz = colour.sRGB_to_XYZ(_to_unit(rgb), apply_cctf_decoding=True)
    return colour.XYZ_to_Lab(
        xyz, illuminant=colour.CCS_ILLUMINANTS["CIE 1931 2 Degree Standard Observer"]["D65"]
    )


def hex_to_lab(h: str) -> np.ndarray:
    h = h.strip().lstrip("#")
    if len(h) != 6:
        raise ValueError(f"expected #RRGGBB, got {h!r}")
    rgb = np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.uint8)
    return srgb_to_lab(rgb)


def de2000(lab1: np.ndarray, lab2: np.ndarray) -> float:
    return float(colour.delta_E(np.asarray(lab1), np.asarray(lab2), method="CIE 2000"))


def apply_linear_gain(img: np.ndarray, g: float) -> np.ndarray:
    """Multiply linear-light RGB by g, re-encode to sRGB, clip. Returns uint8."""
    linear = _decode(_to_unit(img)) * g
    out = _encode(np.clip(linear, 0.0, 1.0))
    return np.clip(np.rint(out * 255.0), 0, 255).astype(np.uint8)

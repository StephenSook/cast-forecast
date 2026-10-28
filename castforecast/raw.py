"""Phone RAW (Apple ProRAW DNG) to linear sRGB for Gate 2 (docs/gates/gate2-preregistration.md).

`SETTINGS` are the registered decoder settings: LibRaw through rawpy, camera white balance, no
auto-brightening, gamma 1, 16 bits, sRGB primaries, highlights clipped, no rotation. They were
written before any Gate 2 photo existed; changing one after the first measurement is a deviation
that gets reported.

A pixel is at the sensor clip level when any channel of the white-balanced camera-space output
reaches full scale: with highlights clipped, LibRaw scales every channel so that a saturated
sensor value lands there. Regions drop those pixels (Amendment 1 rule 1).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import rawpy

FULL = 65535
MAX_CLIPPED = 0.05  # a region with more than this fraction of pixels dropped is unusable

SETTINGS = {
    "use_camera_wb": True,
    "use_auto_wb": False,
    "no_auto_bright": True,
    "gamma": (1, 1),
    "output_bps": 16,
    "output_color": rawpy.ColorSpace.sRGB,
    "highlight_mode": rawpy.HighlightMode.Clip,
    "demosaic_algorithm": rawpy.DemosaicAlgorithm.AHD,
    "fbdd_noise_reduction": rawpy.FBDDNoiseReductionMode.Off,
    "median_filter_passes": 0,
    "bright": 1.0,
    "user_flip": 0,
}


@dataclass(frozen=True)
class Decoded:
    """Linear sRGB (1.0 = LibRaw full scale), the sensor-clip mask, and what LibRaw reported."""

    rgb: np.ndarray  # (H, W, 3) float32
    clipped: np.ndarray  # (H, W) bool
    info: dict


def _info(r) -> dict:
    return {
        "raw_type": r.raw_type.name,
        "size": [int(r.sizes.height), int(r.sizes.width)],
        "raw_size": [int(r.sizes.raw_height), int(r.sizes.raw_width)],
        "flip": int(r.sizes.flip),
        "white_level": int(r.white_level),
        "black_level_per_channel": [int(x) for x in r.black_level_per_channel],
        "camera_whitebalance": [float(x) for x in r.camera_whitebalance],
        "color_desc": bytes(r.color_desc).decode("ascii", "replace"),
        "rawpy": rawpy.__version__,
        "libraw": ".".join(str(x) for x in rawpy.libraw_version),
    }


def decode(path) -> Decoded:
    """Decode one RAW file with `SETTINGS`, plus a camera-space pass that finds clipped pixels."""
    with rawpy.imread(str(path)) as r:
        info = _info(r)
        rgb = r.postprocess(**SETTINGS)
    with rawpy.imread(str(path)) as r:
        cam = r.postprocess(**{**SETTINGS, "output_color": rawpy.ColorSpace.raw})
    if cam.shape != rgb.shape:
        raise ValueError(f"decoder passes disagree in shape: {rgb.shape} vs {cam.shape}")
    clipped = (cam >= FULL).any(axis=2)
    del cam
    return Decoded(rgb.astype(np.float32) / np.float32(FULL), clipped, info)


def region_mean(d: Decoded, mask: np.ndarray):
    """Per-channel mean of the region's unclipped pixels, or None when the region is unusable.

    Unusable means empty, or more than 5 percent of its pixels dropped as clipped.
    """
    n = int(mask.sum())
    if n == 0:
        return None
    keep = mask & ~d.clipped
    if n - int(keep.sum()) > MAX_CLIPPED * n:
        return None
    return d.rgb[keep].mean(axis=0, dtype=np.float64)

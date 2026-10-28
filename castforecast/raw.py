"""Phone RAW (Apple ProRAW DNG) to linear sRGB for Gate 2 (docs/gates/gate2-preregistration.md).

`SETTINGS` are the registered decoder settings: LibRaw through rawpy, camera white balance, no
auto-brightening, gamma 1, 16 bits, sRGB primaries, no rotation. Two of them stop LibRaw from
inventing clipping: highlights are not clipped during white balance (LibRaw then scales by the
largest multiplier, so balancing can never push a channel past full scale), and the data maximum
is the file's white level, never re-estimated from the brightest pixel. They were written before
any Gate 2 photo existed; changing one after the first measurement is a reported deviation.

A pixel is dropped as clipped (Amendment 1 rule 1) when any of its raw sensor samples reaches the
file's white level, read from the unpacked samples before any white balance or interpolation; on
a Bayer sensor every output pixel next to a saturated site is dropped too, since interpolation
uses it. A pixel whose decoded sRGB value sits at full scale is dropped as well: the colour
conversion saturated it, so its value is not a measurement.
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
    "highlight_mode": rawpy.HighlightMode.Ignore,
    "adjust_maximum_thr": 0.0,
    "demosaic_algorithm": rawpy.DemosaicAlgorithm.AHD,
    "fbdd_noise_reduction": rawpy.FBDDNoiseReductionMode.Off,
    "median_filter_passes": 0,
    "bright": 1.0,
    "user_flip": 0,
}


@dataclass(frozen=True)
class Decoded:
    """Linear sRGB (1.0 = LibRaw full scale), the clipped-pixel mask, and what LibRaw reported."""

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


def _white(r) -> np.ndarray:
    per = getattr(r, "camera_white_level_per_channel", None)
    if per is not None and any(per):
        return np.array([w if w else r.white_level for w in per], float)
    return np.full(4, float(r.white_level))


def sensor_clipped(r) -> np.ndarray:
    """Output pixels whose raw samples reached the white level (see the module docstring)."""
    raw = np.asarray(r.raw_image_visible)
    white = _white(r)
    if raw.ndim == 3:  # linear DNG (ProRAW): every pixel carries its own colour samples
        n = min(raw.shape[2], len(r.color_desc), 3)
        return (raw[..., :n] >= white[:n]).any(axis=2)
    sat = raw >= white[np.asarray(r.raw_colors_visible)]
    pad = np.pad(sat, 1)
    rows, cols = sat.shape
    near = np.zeros_like(sat)
    for dy in range(3):
        for dx in range(3):
            near |= pad[dy : dy + rows, dx : dx + cols]
    return near


def decode(path) -> Decoded:
    """Decode one RAW file with `SETTINGS` and mark the pixels to drop."""
    with rawpy.imread(str(path)) as r:
        info = _info(r)
        sensor = sensor_clipped(r)
        rgb = r.postprocess(**SETTINGS)
    if sensor.shape != rgb.shape[:2]:
        raise ValueError(
            f"raw samples and decoded image disagree in shape: {sensor.shape} vs {rgb.shape}"
        )
    clipped = sensor | (rgb >= FULL).any(axis=2)
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

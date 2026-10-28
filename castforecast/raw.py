"""Phone RAW (Apple ProRAW DNG) to linear sRGB for Gate 2 (docs/gates/gate2-preregistration.md).

`SETTINGS` are the registered decoder settings: LibRaw through rawpy, camera white balance, no
auto-brightening, gamma 1, 16 bits, sRGB primaries, no rotation. Two of them stop LibRaw from
inventing clipping: highlights are not clipped during white balance (LibRaw then scales by the
largest multiplier, so balancing can never push a channel past full scale), and the data maximum
is the file's white level, never re-estimated from the brightest pixel. They were written before
any Gate 2 photo existed; changing one after the first measurement is a reported deviation.

Only linear DNGs are decoded (Apple ProRAW: every pixel carries its own three samples, so no
interpolation spreads a saturated sample to its neighbours). A Bayer file, per-channel white
levels that differ, any non-zero black level (BlackLevel, its row and column deltas, or what
LibRaw ends up using), or any DNG opcode list (processing LibRaw may skip) is refused rather than
guessed at. Stephen's iPhone 17 Pro ProRAW files carry none of these.

A pixel is dropped as clipped (Amendment 1 rule 1) when any of its raw samples reaches the
saturation level: the DNG WhiteLevel, or the top of its LinearizationTable if that is lower
(ProRAW stores 10-bit codes and a table; LibRaw hands back the table's values). The levels are
read from the raw IFD itself, not from LibRaw's summary, and samples above them are refused as a
representation mismatch. A pixel whose decoded sRGB value sits at full scale is dropped as well:
the colour conversion saturated it, so its value is not a measurement.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import rawpy
import tifffile

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


LINEAR_RAW = 34892
BLACK_DELTAS = (50715, 50716)  # BlackLevelDeltaH, BlackLevelDeltaV
OPCODE_LISTS = (51008, 51009, 51022)  # OpcodeList1, 2, 3
RATIONAL_TYPES = (
    5,
    10,
)  # TIFF RATIONAL and SRATIONAL: tifffile returns numerator, denominator pairs


def _numbers(tag) -> np.ndarray:
    """A tag's values as numbers, with RATIONAL and SRATIONAL pairs divided out."""
    v = np.atleast_1d(np.asarray(tag.value, float))
    if int(tag.dtype) not in RATIONAL_TYPES:
        return v
    if v.size % 2:
        raise ValueError(f"tag {tag.code} has an odd number of rational parts")
    num, den = v.reshape(-1, 2).T
    if (den == 0).any():
        raise ValueError(f"tag {tag.code} has a zero denominator")
    return num / den


def _raw_ifd(pages):
    for page in pages:
        if page.tags.get(254) is not None and page.tags[254].value == 0 and 262 in page.tags:
            return page
        found = _raw_ifd(page.pages) if page.pages else None
        if found is not None:
            return found
    return None


def saturation_level(path) -> float:
    """The raw sample value at which the sensor saturates, from the DNG raw IFD's own tags.

    ValueError for anything but a linear DNG with one white level, a zero black level and no
    opcode lists.
    """
    with tifffile.TiffFile(str(path)) as tf:
        ifd = _raw_ifd(tf.pages)
        if ifd is None:
            raise ValueError("no raw image in this file")
        tags = ifd.tags
        for page in (tf.pages[0], ifd):
            if any(code in page.tags for code in OPCODE_LISTS):
                raise ValueError("DNG opcode lists are not supported")
        for code in BLACK_DELTAS:
            if code in tags and (_numbers(tags[code]) != 0).any():
                raise ValueError("a non-zero black level delta is not supported")
        if tags[262].value != LINEAR_RAW:
            raise ValueError(
                f"only linear DNG (ProRAW) is supported, photometric {tags[262].value}"
            )
        bits = np.atleast_1d(tags[258].value)
        white = _numbers(tags[50717]) if 50717 in tags else 2.0**bits - 1
        black = _numbers(tags[50714]) if 50714 in tags else np.zeros(1)
        if len({float(w) for w in white}) != 1:
            raise ValueError("per-channel white levels are not supported")
        if any(float(b) != 0 for b in black):
            raise ValueError("a non-zero black level is not supported")
        level = float(white[0])
        if 50712 in tags:
            level = min(level, float(np.max(_numbers(tags[50712]))))
    return level


def sensor_clipped(r, level: float) -> np.ndarray:
    """Output pixels with any raw sample at or above `level` (see the module docstring)."""
    raw = np.asarray(r.raw_image_visible)
    if raw.ndim != 3:
        raise ValueError("only linear DNG (ProRAW) is supported, not a Bayer mosaic")
    n = min(raw.shape[2], 3)
    samples = raw[..., :n]
    if samples.max(initial=0) > level:
        raise ValueError(f"raw samples exceed the saturation level {level:g}")
    return (samples >= level).any(axis=2)


def decode(path) -> Decoded:
    """Decode one RAW file with `SETTINGS` and mark the pixels to drop."""
    level = saturation_level(path)
    with rawpy.imread(str(path)) as r:
        info = _info(r) | {"saturation_level": level}
        if any(info["black_level_per_channel"]):
            raise ValueError("LibRaw applied a non-zero black level, which is not supported")
        sensor = sensor_clipped(r, level)
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

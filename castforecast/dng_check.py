"""Check one phone RAW file against the Gate 2 decoder before anything is measured from it.

    python -m castforecast.dng_check IMG_0001.DNG [--preview preview.jpg]

Prints what LibRaw reported, the size, the share of sensor-clipped pixels, channel percentiles
and whether the file carries GPS data (True, False, or "unknown: ..." when the check itself
failed, which is never read as absent). It computes no Gate 2 outcome. The preview is for
looking only: it is brightened to fit the screen, and clipped pixels are painted magenta.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import rawpy
from PIL import ExifTags, Image

from castforecast.raw import Decoded, decode

# What a file Pillow cannot parse raises (UnidentifiedImageError is an OSError).
_READ_ERRORS = (OSError, ValueError, SyntaxError)


def gps_state(path):
    """True or False for a GPS block in the file's EXIF, or "unknown: ..." if it cannot be read."""
    try:
        with Image.open(path) as im:
            gps = im.getexif().get_ifd(ExifTags.Base.GPSInfo)
    except _READ_ERRORS as e:  # the failure is reported, never treated as "no GPS"
        return f"unknown: {type(e).__name__}: {e}"
    return bool(gps)


def _model(path):
    try:
        with Image.open(path) as im:
            return im.getexif().get(ExifTags.Base.Model)
    except _READ_ERRORS:
        return None


def _stats(ch: np.ndarray) -> dict:
    p1, p50, p99 = np.percentile(ch, [1, 50, 99])
    return {
        "p1": float(p1),
        "p50": float(p50),
        "p99": float(p99),
        "max": float(ch.max()),
        "share_over_0.95": float((ch >= 0.95).mean()),
    }


def preview(d: Decoded, out, max_side: int = 1600) -> None:
    """Save a display copy: every n-th pixel, scaled so the 99.5th percentile is white."""
    step = max(1, math.ceil(max(d.clipped.shape) / max_side))
    x = d.rgb[::step, ::step].astype(np.float64)
    x = np.clip(x / max(float(np.percentile(x, 99.5)), 1e-6), 0.0, 1.0)
    enc = np.where(x <= 0.0031308, 12.92 * x, 1.055 * x ** (1 / 2.4) - 0.055)
    img = np.round(enc * 255).astype(np.uint8)
    img[d.clipped[::step, ::step]] = (255, 0, 255)
    Image.fromarray(img).save(out)


def report(path, preview_path=None) -> dict:
    path = Path(path)
    rep = {
        "file": path.name,
        "bytes": path.stat().st_size,
        "model": _model(path),
        "gps": gps_state(path),
    }
    try:
        d = decode(path)
    except (rawpy.LibRawError, *_READ_ERRORS, MemoryError) as e:  # the failure is the finding
        rep.update(decoded=False, error=f"{type(e).__name__}: {e}")
        return rep
    h, w = d.clipped.shape
    rep.update(decoded=True, **d.info)
    rep["megapixels"] = h * w / 1e6
    rep["clipped_fraction"] = float(d.clipped.mean())
    rep["channels"] = {c: _stats(d.rgb[..., i]) for i, c in enumerate("RGB")}
    if preview_path:
        preview(d, preview_path)
    return rep


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Check a RAW file against the Gate 2 decoder")
    ap.add_argument("path")
    ap.add_argument("--preview", help="write a display JPEG here")
    a = ap.parse_args(argv)
    rep = report(a.path, a.preview)
    print(json.dumps(rep, indent=2))
    return 0 if rep["decoded"] else 1


if __name__ == "__main__":
    sys.exit(main())

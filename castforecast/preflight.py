"""Selfie preflight and the privacy gate: only upload_copy outputs ever leave the machine."""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageCms, ImageOps

MAX_BYTES = 10 * 1024 * 1024
HD_SHORT_SIDE = 1080
MIN_SHORT_SIDE = 480
ALLOWED_FORMATS = {"JPEG", "PNG"}


def preflight(path: Path) -> dict:
    """Check format, size and resolution. `hd` is True at 1080+ short side."""
    path = Path(path)
    size = path.stat().st_size
    reasons: list[str] = []
    short_side = 0
    try:
        with Image.open(path) as im:
            fmt = im.format
            oriented = ImageOps.exif_transpose(im)
            short_side = min(oriented.size)
    except OSError as exc:
        return {
            "ok": False,
            "reasons": [f"unreadable image: {exc}"],
            "short_side": 0,
            "bytes": size,
            "hd": False,
        }
    if fmt not in ALLOWED_FORMATS:
        reasons.append(f"format {fmt} not allowed, need JPEG or PNG")
    if size >= MAX_BYTES:
        reasons.append(f"file is {size} bytes, must be under 10 MB")
    if short_side < MIN_SHORT_SIDE:
        reasons.append(f"short side {short_side}px is under the {MIN_SHORT_SIDE}px minimum")
    return {
        "ok": not reasons,
        "reasons": reasons,
        "short_side": short_side,
        "bytes": size,
        "hd": short_side >= HD_SHORT_SIDE,
    }


def upload_copy(path: Path, out_dir: Path) -> Path:
    """Write the metadata-free sRGB JPEG that is actually uploaded."""
    path = Path(path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(path) as im:
        icc = im.info.get("icc_profile")
        im = ImageOps.exif_transpose(im)  # applies orientation, drops the tag
        im = im.convert("RGB") if not icc else im
        if icc:
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            dst = ImageCms.createProfile("sRGB")
            im = ImageCms.profileToProfile(
                im.convert("RGB"),
                src,
                dst,
                renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
                outputMode="RGB",
            )
        # Fresh image from pixels: nothing from the source container can survive.
        clean = Image.new("RGB", im.size)
        clean.paste(im)
    out = out_dir / f"{path.stem}.upload.jpg"
    clean.save(out, "JPEG", quality=95)  # no exif=, no icc_profile= : no metadata written
    return out

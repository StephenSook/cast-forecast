"""Selfie preflight and the privacy gate: only upload_copy outputs ever leave the machine."""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
from PIL import Image, ImageCms, ImageOps

MAX_BYTES = 10 * 1024 * 1024
HD_SHORT_SIDE = 1080
MIN_SHORT_SIDE = 480
# iPhone JPEGs carry an MPF header and open as MPO; the primary frame is a normal JPEG.
ALLOWED_FORMATS = {"JPEG", "MPO", "PNG"}


def preflight(path: Path) -> dict:
    """Check format, size and resolution. `hd` is True at 1080+ short side."""
    path = Path(path)
    size = path.stat().st_size
    reasons: list[str] = []
    try:
        with Image.open(path) as im:
            fmt = im.format
            width, height = ImageOps.exif_transpose(im).size
    except (OSError, Image.DecompressionBombError) as exc:
        return {
            "ok": False,
            "reasons": [f"unreadable image: {exc}"],
            "short_side": 0,
            "width": 0,
            "height": 0,
            "bytes": size,
            "hd": False,
        }
    short_side = min(width, height)
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
        "width": width,
        "height": height,
        "bytes": size,
        "hd": short_side >= HD_SHORT_SIDE,
    }


_PROFILE_SPACE_FOR_MODE = {"RGB": "RGB ", "L": "GRAY"}


def _to_srgb(im: Image.Image, icc: bytes | None) -> Image.Image:
    """Return an 8-bit RGB image in sRGB, honouring an embedded profile when it fits."""
    mode = im.mode
    if mode in ("I;16", "I;16L", "I;16B"):  # 16-bit gray: scale, never clip
        arr = np.asarray(im).astype(np.float64) / 65535.0
        im = Image.fromarray(np.rint(arr * 255.0).astype(np.uint8), "L")
        mode = "L"
    elif mode in ("RGBA", "LA", "P", "PA"):
        im = im.convert("RGB" if mode != "LA" else "L")
        mode = im.mode
    if mode not in _PROFILE_SPACE_FOR_MODE:
        raise ValueError(f"unsupported image mode {mode}; export the photo as 8-bit RGB")
    if not icc:
        return im.convert("RGB")
    src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
    space = src.profile.xcolor_space
    if space != _PROFILE_SPACE_FOR_MODE[mode]:
        raise ValueError(
            f"embedded ICC profile color space {space.strip()!r} does not match "
            f"image mode {mode}; re-export the photo as sRGB"
        )
    return ImageCms.profileToProfile(
        im,
        src,
        ImageCms.createProfile("sRGB"),
        renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
        outputMode="RGB",
    )


def upload_copy(
    path: Path, out_dir: Path, max_width: int | None = None, max_height: int | None = None
) -> Path:
    """Write the metadata-free sRGB JPEG that is actually uploaded.

    With max_width / max_height the copy is shrunk (never enlarged) with LANCZOS, aspect ratio
    preserved, so that width < max_width AND height < max_height (strict).

    Raises ValueError for unsupported modes (CMYK etc.) or a profile that does not match.
    """
    path = Path(path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(path) as im:
        icc = im.info.get("icc_profile")
        converted = _to_srgb(ImageOps.exif_transpose(im), icc)  # orientation applied
        # Fresh image from pixels: nothing from the source container can survive.
        clean = Image.new("RGB", converted.size)
        clean.paste(converted)
    if max_width is not None or max_height is not None:
        w, h = clean.size
        mw = max_width - 1 if max_width is not None else w
        mh = max_height - 1 if max_height is not None else h
        scale = min(mw / w, mh / h, 1.0)
        if scale < 1.0:
            nw, nh = min(mw, max(1, int(w * scale))), min(mh, max(1, int(h * scale)))
            clean = clean.resize((nw, nh), Image.Resampling.LANCZOS)
    out = out_dir / f"{path.stem}.upload.jpg"
    clean.save(out, "JPEG", quality=95)  # no exif=, no icc_profile= : no metadata written
    return out

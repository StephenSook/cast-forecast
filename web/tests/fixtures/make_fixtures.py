"""Write the image fixtures used by the web unit tests. None of them is a face.

Run from the repo root: .venv/bin/python -I web/tests/fixtures/make_fixtures.py
"""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, TiffImagePlugin

HERE = Path(__file__).resolve().parent
ORIENTATION = 0x0112
GPS_IFD = 0x8825


def gradient(width: int, height: int) -> Image.Image:
    """Red ramps left to right, green ramps top to bottom, blue is flat."""
    ramp = Image.linear_gradient("L")  # 256x256, dark at the top
    green = ramp.resize((width, height))
    red = ramp.transpose(Image.Transpose.ROTATE_90).resize((width, height))
    blue = Image.new("L", (width, height), 128)
    return Image.merge("RGB", (red, green, blue))


def gps_exif() -> Image.Exif:
    """EXIF Orientation 6 and a GPS IFD at 0,0."""
    zero = TiffImagePlugin.IFDRational(0, 1)
    exif = Image.Exif()
    exif[ORIENTATION] = 6
    exif[GPS_IFD] = {
        1: "N",  # GPSLatitudeRef
        2: (zero, zero, zero),  # GPSLatitude: degrees, minutes, seconds
        3: "E",  # GPSLongitudeRef
        4: (zero, zero, zero),  # GPSLongitude: degrees, minutes, seconds
    }
    return exif


def rotated_with_gps() -> tuple[Image.Image, Image.Exif]:
    """Stored landscape 4032x3024 with a dark band on the left third, EXIF Orientation 6, GPS 0,0."""
    im = Image.new("RGB", (4032, 3024), (200, 170, 150))
    im.paste((30, 30, 30), (0, 0, 4032 // 3, 3024))
    return im, gps_exif()


def main() -> None:
    written: list[Path] = []

    out = HERE / "plain-640x480.jpg"
    gradient(640, 480).save(out, "JPEG", quality=90)
    written.append(out)

    out = HERE / "exif-rot6-4032x3024.jpg"
    im, exif = rotated_with_gps()
    im.save(out, "JPEG", quality=80, exif=exif)
    written.append(out)

    out = HERE / "tall-1080x4000.jpg"
    gradient(1080, 4000).save(out, "JPEG", quality=90)
    written.append(out)

    out = HERE / "not-an-image.heic"
    out.write_bytes(b"\x00\x00\x00\x18ftypheic" + random.Random(7).randbytes(2048))
    written.append(out)

    # Real encoder output for the strip: many scans, and restart markers inside the scan data.
    out = HERE / "progressive-640x480.jpg"
    gradient(640, 480).save(
        out, "JPEG", quality=85, progressive=True, exif=gps_exif(), comment=b"COM-SECRET"
    )
    written.append(out)

    out = HERE / "restart-640x480.jpg"
    gradient(640, 480).save(
        out, "JPEG", quality=85, restart_marker_blocks=1, exif=gps_exif(), comment=b"COM-SECRET"
    )
    written.append(out)

    for path in written:
        print(f"{path.name} {path.stat().st_size} bytes")
    print(f"{len(written)} files written")


if __name__ == "__main__":
    main()

"""Hand-built minimal ICC v2 profiles so color-management tests run on every OS."""

from __future__ import annotations

import struct


def _s15(x: float) -> bytes:
    return struct.pack(">i", round(x * 65536))


def _xyz(x: float, y: float, z: float) -> bytes:
    return b"XYZ \0\0\0\0" + _s15(x) + _s15(y) + _s15(z)


def _gamma(g: float) -> bytes:
    return b"curv\0\0\0\0" + struct.pack(">IH", 1, round(g * 256)) + b"\0\0"


def _text(s: str) -> bytes:
    return b"text\0\0\0\0" + s.encode() + b"\0"


def _desc(s: str) -> bytes:
    raw = s.encode() + b"\0"
    return (
        b"desc\0\0\0\0"
        + struct.pack(">I", len(raw))
        + raw
        + struct.pack(">IIH", 0, 0, 0)
        + bytes(68)
    )


def _build(space: bytes, tags: dict[bytes, bytes]) -> bytes:
    sigs = list(tags)
    offset = 128 + 4 + 12 * len(sigs)
    table = struct.pack(">I", len(sigs))
    body = b""
    for sig in sigs:
        data = tags[sig]
        data += bytes(-len(data) % 4)
        table += sig + struct.pack(">II", offset + len(body), len(data))
        body += data
    header = bytearray(128)
    struct.pack_into(">I", header, 8, 0x02400000)
    header[12:16] = b"mntr"
    header[16:20] = space
    header[20:24] = b"XYZ "
    header[36:40] = b"acsp"
    header[68:80] = _s15(0.9642) + _s15(1.0) + _s15(0.8249)
    out = bytes(header) + table + body
    return struct.pack(">I", len(out)) + out[4:]


def wide_gamut_rgb_profile() -> bytes:
    """Display-P3-like primaries (D50 adapted) with a plain 2.2 gamma. Not sRGB."""
    return _build(
        b"RGB ",
        {
            b"desc": _desc("test wide gamut"),
            b"cprt": _text("public domain test fixture"),
            b"wtpt": _xyz(0.9642, 1.0, 0.8249),
            b"rXYZ": _xyz(0.5151, 0.2412, -0.0011),
            b"gXYZ": _xyz(0.2920, 0.6922, 0.0419),
            b"bXYZ": _xyz(0.1571, 0.0666, 0.7841),
            b"rTRC": _gamma(2.2),
            b"gTRC": _gamma(2.2),
            b"bTRC": _gamma(2.2),
        },
    )


def gray_profile(gamma: float = 3.0) -> bytes:
    return _build(
        b"GRAY",
        {
            b"desc": _desc("test gray"),
            b"cprt": _text("public domain test fixture"),
            b"wtpt": _xyz(0.9642, 1.0, 0.8249),
            b"kTRC": _gamma(gamma),
        },
    )

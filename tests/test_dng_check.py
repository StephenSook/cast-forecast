"""Tests for the RAW file check (castforecast/dng_check.py)."""

import numpy as np
import rawpy
from PIL import ExifTags, Image

from castforecast import dng_check
from castforecast.raw import Decoded


def _jpeg(path, gps):
    exif = Image.Exif()
    exif[ExifTags.Base.Model] = "iPhone 17 Pro"
    if gps:
        exif[ExifTags.Base.GPSInfo] = {ExifTags.GPS.GPSLatitudeRef: "N"}
    Image.new("RGB", (8, 8)).save(path, exif=exif)
    return path


def test_gps_is_found_when_present_and_absent_otherwise(tmp_path):
    assert dng_check.gps_state(_jpeg(tmp_path / "with.jpg", gps=True)) is True
    assert dng_check.gps_state(_jpeg(tmp_path / "without.jpg", gps=False)) is False


def test_an_unreadable_file_is_unknown_never_absent(tmp_path):
    bad = tmp_path / "bad.dng"
    bad.write_bytes(b"not a tiff")
    got = dng_check.gps_state(bad)
    assert isinstance(got, str) and got.startswith("unknown")


def test_report_summarises_the_decode(tmp_path, monkeypatch):
    rgb = np.full((4, 5, 3), 0.25, np.float32)
    clipped = np.zeros((4, 5), bool)
    clipped[0, :2] = True
    monkeypatch.setattr(dng_check, "decode", lambda p: Decoded(rgb, clipped, {"raw_type": "Stack"}))
    f = _jpeg(tmp_path / "x.jpg", gps=False)

    rep = dng_check.report(f)

    assert rep["decoded"] is True
    assert rep["raw_type"] == "Stack"
    assert rep["megapixels"] == 20 / 1e6
    assert rep["clipped_fraction"] == 0.1
    assert rep["gps"] is False
    assert rep["model"] == "iPhone 17 Pro"
    assert rep["channels"]["G"]["p50"] == 0.25


def test_report_records_a_decode_failure(tmp_path, monkeypatch):
    def boom(p):
        raise rawpy.LibRawFileUnsupportedError("unsupported compression")

    monkeypatch.setattr(dng_check, "decode", boom)
    rep = dng_check.report(_jpeg(tmp_path / "x.jpg", gps=False))
    assert rep["decoded"] is False
    assert "unsupported compression" in rep["error"]


def test_preview_marks_clipped_pixels_magenta(tmp_path):
    rgb = np.full((4, 4, 3), 0.2, np.float32)
    clipped = np.zeros((4, 4), bool)
    clipped[1, 1] = True
    out = tmp_path / "p.png"
    dng_check.preview(Decoded(rgb, clipped, {}), out, max_side=4)
    px = np.asarray(Image.open(out))
    assert px.shape == (4, 4, 3)
    assert px[1, 1].tolist() == [255, 0, 255]
    assert px[0, 0, 0] == px[0, 0, 1] == px[0, 0, 2] > 0


def test_a_gps_pointer_past_the_end_is_unknown_not_absent(tmp_path):
    # Codex review r1: Pillow warned "Corrupt EXIF data" and returned an empty block, read as False.
    exif = Image.Exif()
    exif[ExifTags.Base.GPSInfo] = {ExifTags.GPS.GPSLatitudeRef: "N"}
    raw = exif.tobytes()
    entry = b"\x88\x25\x00\x04\x00\x00\x00\x01"  # big-endian GPS pointer, LONG, count 1
    assert raw.count(entry) == 1
    i = raw.find(entry) + len(entry)
    bad = raw[:i] + b"\x7f\xff\xff\xff" + raw[i + 4 :]
    path = tmp_path / "bad_gps.jpg"
    Image.new("RGB", (8, 8)).save(path, exif=bad)
    got = dng_check.gps_state(path)
    assert isinstance(got, str) and got.startswith("unknown")

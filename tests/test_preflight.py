import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageCms

from castforecast.preflight import preflight, upload_copy


def _jpeg(path: Path, size=(1200, 1600), **save_kw) -> Path:
    arr = np.random.default_rng(0).integers(0, 255, (size[1], size[0], 3), dtype=np.uint8)
    Image.fromarray(arr).save(path, "JPEG", **save_kw)
    return path


def test_preflight_accepts_good_jpeg(tmp_path):
    r = preflight(_jpeg(tmp_path / "ok.jpg"))
    assert r["ok"] and r["reasons"] == [] and r["short_side"] == 1200 and r["bytes"] > 0


def test_preflight_rejects_small_and_huge(tmp_path):
    small = preflight(_jpeg(tmp_path / "s.jpg", size=(300, 400)))
    assert not small["ok"] and any("short side" in x for x in small["reasons"])
    huge = tmp_path / "h.jpg"
    _jpeg(huge)
    with huge.open("ab") as f:
        f.write(b"\0" * (10 * 1024 * 1024))
    big = preflight(huge)
    assert not big["ok"] and any("10 MB" in x for x in big["reasons"])


def test_preflight_rejects_wrong_format_and_flags_sd(tmp_path):
    p = tmp_path / "x.gif"
    Image.new("RGB", (1200, 1200)).save(p, "GIF")
    assert not preflight(p)["ok"]
    sd = preflight(_jpeg(tmp_path / "sd.jpg", size=(600, 800)))
    assert sd["ok"] and sd["short_side"] == 600


def test_preflight_applies_exif_orientation(tmp_path):
    p = tmp_path / "rot.jpg"
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90 CW on display: stored 1600x1200 shows as 1200x1600
    arr = np.zeros((1200, 1600, 3), dtype=np.uint8)
    Image.fromarray(arr).save(p, "JPEG", exif=exif)
    assert preflight(p)["short_side"] == 1200


def test_upload_copy_strips_gps_exif_and_icc(tmp_path):
    exif = Image.Exif()
    exif[0x010F] = "TestMake"
    exif[0x0112] = 6
    exif.get_ifd(0x8825)[1] = "N"  # GPS IFD
    exif.get_ifd(0x8825)[2] = (33.0, 45.0, 0.0)
    p3ish = ImageCms.createProfile("sRGB")
    icc = ImageCms.ImageCmsProfile(p3ish).tobytes()
    src = tmp_path / "src.jpg"
    arr = np.full((1200, 1600, 3), 120, dtype=np.uint8)
    Image.fromarray(arr).save(src, "JPEG", exif=exif, icc_profile=icc)
    with Image.open(src) as chk:
        assert chk.info.get("icc_profile") and 0x8825 in chk.getexif()

    out = upload_copy(src, tmp_path / "out")
    assert out.parent == tmp_path / "out" and out.suffix == ".jpg"
    with Image.open(out) as im:
        assert im.format == "JPEG"
        assert len(im.getexif()) == 0 and not im.getexif().get_ifd(0x8825)
        assert "icc_profile" not in im.info and "exif" not in im.info
        assert im.size == (1200, 1600)  # orientation applied
    raw = out.read_bytes()
    assert b"Exif" not in raw and b"ICC_PROFILE" not in raw


P3_PROFILE = Path("/System/Library/ColorSync/Profiles/Display P3.icc")


@pytest.mark.skipif(not P3_PROFILE.exists(), reason="no system Display P3 profile")
def test_upload_copy_converts_display_p3_to_srgb(tmp_path):
    src = tmp_path / "p3.jpg"
    Image.fromarray(np.full((1100, 1100, 3), (200, 80, 60), dtype=np.uint8)).save(
        src, "JPEG", quality=100, icc_profile=P3_PROFILE.read_bytes()
    )
    out = upload_copy(src, tmp_path / "o")
    with Image.open(out) as im:
        px = np.asarray(im.convert("RGB"))[550, 550].astype(int)
        assert "icc_profile" not in im.info
    # P3 reds are more saturated than sRGB: converting must push R up and G, B down.
    assert px[0] > 200 + 5 and px[1] < 80 - 5 and px[2] < 60


def test_upload_copy_no_icc_passthrough(tmp_path):
    src = _jpeg(tmp_path / "plain.jpg")
    out = upload_copy(src, tmp_path / "o2")
    buf = io.BytesIO(out.read_bytes())
    with Image.open(buf) as im:
        assert im.size == (1200, 1600)

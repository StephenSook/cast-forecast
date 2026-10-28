import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageCms

from castforecast.preflight import preflight, upload_copy
from tests.icc_helpers import gray_profile, wide_gamut_rgb_profile


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
    exif[0x0112] = 6  # stored 1600x1200 displays as 1200 wide, 1600 tall
    Image.fromarray(np.zeros((1200, 1600, 3), dtype=np.uint8)).save(p, "JPEG", exif=exif)
    r = preflight(p)
    assert (r["width"], r["height"]) == (1200, 1600)


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


def _px(path):
    with Image.open(path) as im:
        assert "icc_profile" not in im.info
        return np.asarray(im.convert("RGB"))[550, 550].astype(int)


def test_upload_copy_converts_embedded_wide_gamut_profile(tmp_path):
    patch = np.full((1100, 1100, 3), (30, 200, 60), dtype=np.uint8)
    tagged = tmp_path / "wide.png"
    Image.fromarray(patch).save(tagged, "PNG", icc_profile=wide_gamut_rgb_profile())
    untagged = tmp_path / "plain.png"
    Image.fromarray(patch).save(untagged, "PNG")
    converted = _px(upload_copy(tagged, tmp_path / "a"))
    ignored = _px(upload_copy(untagged, tmp_path / "b"))
    # A wide-gamut green is more saturated than the same numbers read as sRGB, so honouring
    # the profile must change the result by a clear margin on at least one channel.
    assert np.abs(converted - ignored).max() >= 15


def test_upload_copy_applies_gray_profile(tmp_path):
    tagged = tmp_path / "g.png"
    Image.fromarray(np.full((1100, 1100), 128, dtype=np.uint8)).save(
        tagged, "PNG", icc_profile=gray_profile(3.0)
    )
    px = _px(upload_copy(tagged, tmp_path / "o"))
    assert abs(int(px[0]) - 128) >= 10 and px[0] == px[1] == px[2]


def test_upload_copy_rejects_profile_that_does_not_match_mode(tmp_path):
    src = tmp_path / "bad.png"
    Image.fromarray(np.full((1100, 1100, 3), 90, dtype=np.uint8)).save(
        src, "PNG", icc_profile=gray_profile()
    )
    with pytest.raises(ValueError, match="does not match"):
        upload_copy(src, tmp_path / "o")


def test_upload_copy_rejects_cmyk_clearly(tmp_path):
    src = tmp_path / "cmyk.jpg"
    Image.new("CMYK", (1100, 1100), (0, 0, 0, 0)).save(src, "JPEG")
    with pytest.raises(ValueError, match="unsupported image mode CMYK"):
        upload_copy(src, tmp_path / "o")


def test_upload_copy_scales_16_bit_png_instead_of_clipping(tmp_path):
    src = tmp_path / "deep.png"
    Image.fromarray(np.full((1100, 1100), 40000, dtype=np.uint16)).save(src, "PNG")
    with Image.open(src) as chk:
        assert chk.mode.startswith("I")
    px = _px(upload_copy(src, tmp_path / "o"))
    assert abs(int(px[0]) - round(40000 / 257)) <= 2


def _mpo(path):
    a = Image.fromarray(np.full((1200, 900, 3), 100, dtype=np.uint8))
    b = Image.fromarray(np.full((1200, 900, 3), 50, dtype=np.uint8))
    a.save(path, "MPO", save_all=True, append_images=[b])
    with Image.open(path) as chk:
        assert chk.format == "MPO"
    return path


def test_preflight_and_upload_copy_accept_mpo(tmp_path):
    src = _mpo(tmp_path / "iphone.jpg")
    r = preflight(src)
    assert r["ok"], r["reasons"]
    out = upload_copy(src, tmp_path / "o")
    with Image.open(out) as im:
        assert im.format == "JPEG" and im.size == (900, 1200)
        assert not getattr(im, "n_frames", 1) > 1


def test_preflight_returns_rejection_for_decompression_bomb(tmp_path, monkeypatch):
    src = _jpeg(tmp_path / "big.jpg")
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)
    r = preflight(src)
    assert not r["ok"] and r["reasons"]


def test_upload_copy_strips_xmp_and_comment(tmp_path):
    src = tmp_path / "meta.jpg"
    xmp = b"<?xpacket begin?><x:xmpmeta xmlns:x='adobe:ns:meta/'>SECRETXMP</x:xmpmeta>"
    Image.fromarray(np.full((1100, 1100, 3), 90, dtype=np.uint8)).save(
        src, "JPEG", xmp=xmp, comment=b"SECRETCOMMENT"
    )
    assert b"SECRETXMP" in src.read_bytes() and b"SECRETCOMMENT" in src.read_bytes()
    raw = upload_copy(src, tmp_path / "o").read_bytes()
    assert b"SECRETXMP" not in raw and b"SECRETCOMMENT" not in raw and b"xmpmeta" not in raw


def test_upload_copy_no_icc_passthrough(tmp_path):
    src = _jpeg(tmp_path / "plain.jpg")
    out = upload_copy(src, tmp_path / "o2")
    buf = io.BytesIO(out.read_bytes())
    with Image.open(buf) as im:
        assert im.size == (1200, 1600)

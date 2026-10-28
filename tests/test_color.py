import numpy as np
import pytest

from castforecast.color import apply_linear_gain, de2000, hex_to_lab, srgb_to_lab

SHARMA = [
    ((50.0000, 2.6772, -79.7751), (50.0000, 0.0000, -82.7485), 2.0425),
    ((50.0000, 3.1571, -77.2803), (50.0000, 0.0000, -82.7485), 2.8615),
    ((50.0000, 2.8361, -74.0200), (50.0000, 0.0000, -82.7485), 3.4412),
]


@pytest.mark.parametrize(("lab1", "lab2", "expected"), SHARMA)
def test_de2000_sharma_pairs(lab1, lab2, expected):
    assert de2000(np.array(lab1), np.array(lab2)) == pytest.approx(expected, abs=1e-3)


def test_hex_to_lab_white_is_L100():
    lab = hex_to_lab("#FFFFFF")
    assert lab[0] == pytest.approx(100.0, abs=0.05)
    assert abs(lab[1]) < 0.1 and abs(lab[2]) < 0.1


def test_srgb_to_lab_accepts_uint8_and_unit_float():
    a = srgb_to_lab(np.array([128, 64, 200], dtype=np.uint8))
    b = srgb_to_lab(np.array([128, 64, 200]) / 255.0)
    assert np.allclose(a, b, atol=1e-6)


def _luminance(img):
    lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)
    return float((lin * np.array([0.2126, 0.7152, 0.0722])).sum(axis=-1).mean())


def test_linear_gain_10pct_raises_Y_10pct():
    patch = np.full((8, 8, 3), 118, dtype=np.uint8)
    out = apply_linear_gain(patch, 1.10)
    assert out.dtype == np.uint8 and out.shape == patch.shape
    ratio = _luminance(out / 255.0) / _luminance(patch / 255.0)
    assert ratio == pytest.approx(1.10, abs=0.01)


def test_linear_gain_clips():
    out = apply_linear_gain(np.full((2, 2, 3), 250, dtype=np.uint8), 3.0)
    assert out.max() == 255


@pytest.mark.parametrize("dtype", [np.int32, np.int64, np.uint16, np.int8, bool])
def test_non_uint8_integer_dtypes_rejected(dtype):
    with pytest.raises(TypeError, match="uint8 or float"):
        srgb_to_lab(np.array([128, 64, 1]).astype(dtype))
    with pytest.raises(TypeError):
        apply_linear_gain(np.full((2, 2, 3), 1).astype(dtype), 1.1)

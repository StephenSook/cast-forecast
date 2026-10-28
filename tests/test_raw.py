"""Tests for the Gate 2 RAW decoder (castforecast/raw.py), against docs/gates/gate2-preregistration.md."""

from types import SimpleNamespace

import numpy as np
import pytest
import rawpy

from castforecast import raw
from castforecast.raw import FULL, SETTINGS, Decoded, decode, region_mean


def test_settings_are_the_registered_decoder():
    # Measurement: camera white balance, no auto-brightening, no gamma. Changing any of these
    # after the first Gate 2 measurement is a deviation, so this test pins them.
    assert SETTINGS == {
        "use_camera_wb": True,
        "use_auto_wb": False,
        "no_auto_bright": True,
        "gamma": (1, 1),
        "output_bps": 16,
        "output_color": rawpy.ColorSpace.sRGB,
        "highlight_mode": rawpy.HighlightMode.Clip,
        "demosaic_algorithm": rawpy.DemosaicAlgorithm.AHD,
        "fbdd_noise_reduction": rawpy.FBDDNoiseReductionMode.Off,
        "median_filter_passes": 0,
        "bright": 1.0,
        "user_flip": 0,
    }


class FakeRaw:
    """Stands in for rawpy.RawPy: returns a fixed array per output colour space."""

    def __init__(self, outputs, calls):
        self.outputs = outputs
        self.calls = calls
        self.raw_type = rawpy.RawType.Stack
        self.sizes = SimpleNamespace(raw_height=2, raw_width=2, height=2, width=2, flip=0)
        self.white_level = 65535
        self.black_level_per_channel = [0, 0, 0, 0]
        self.camera_whitebalance = [2.0, 1.0, 1.5, 0.0]
        self.color_desc = b"RGBG"

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def postprocess(self, **kw):
        self.calls.append(kw)
        return self.outputs[kw["output_color"]]


def _patch(monkeypatch, srgb, cam):
    calls = []
    outputs = {rawpy.ColorSpace.sRGB: srgb, rawpy.ColorSpace.raw: cam}
    monkeypatch.setattr(raw.rawpy, "imread", lambda path: FakeRaw(outputs, calls))
    return calls


def test_decode_uses_the_settings_and_marks_sensor_clipping(monkeypatch):
    srgb = np.array([[[100, 200, 300], [65535, 400, 500]], [[0, 1, 2], [3, 4, 5]]], dtype=np.uint16)
    cam = np.full((2, 2, 3), 1000, dtype=np.uint16)
    cam[0, 1, 2] = FULL  # one channel at the clip level marks the pixel
    calls = _patch(monkeypatch, srgb, cam)

    d = decode("x.dng")

    assert calls == [SETTINGS, {**SETTINGS, "output_color": rawpy.ColorSpace.raw}]
    assert d.clipped.tolist() == [[False, True], [False, False]]
    assert d.rgb.dtype == np.float32
    np.testing.assert_allclose(d.rgb, srgb / FULL, rtol=1e-6)
    assert d.info["raw_type"] == "Stack"
    assert d.info["size"] == [2, 2]
    assert d.info["camera_whitebalance"] == [2.0, 1.0, 1.5, 0.0]


def test_a_saturated_srgb_value_alone_is_not_sensor_clipping(monkeypatch):
    srgb = np.full((2, 2, 3), FULL, dtype=np.uint16)
    cam = np.full((2, 2, 3), 1000, dtype=np.uint16)
    _patch(monkeypatch, srgb, cam)
    assert not decode("x.dng").clipped.any()


def test_decode_refuses_passes_that_disagree_in_shape(monkeypatch):
    _patch(monkeypatch, np.zeros((2, 2, 3), np.uint16), np.zeros((2, 3, 3), np.uint16))
    with pytest.raises(ValueError, match="shape"):
        decode("x.dng")


def _decoded(n_clipped):
    rgb = np.zeros((10, 10, 3), np.float32)
    rgb[..., 0] = 0.5
    rgb[..., 1] = 0.25
    clipped = np.zeros((10, 10), bool)
    clipped.flat[:n_clipped] = True
    rgb[clipped] = 1.0  # clipped pixels carry a value that must not reach the mean
    return Decoded(rgb, clipped, {})


def test_region_mean_drops_clipped_pixels_up_to_five_percent():
    mask = np.ones((10, 10), bool)
    got = region_mean(_decoded(5), mask)  # exactly 5 percent dropped is still usable
    np.testing.assert_allclose(got, [0.5, 0.25, 0.0])


def test_region_with_more_than_five_percent_clipped_is_unusable():
    assert region_mean(_decoded(6), np.ones((10, 10), bool)) is None


def test_empty_region_is_unusable():
    assert region_mean(_decoded(0), np.zeros((10, 10), bool)) is None

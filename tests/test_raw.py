"""Tests for the Gate 2 RAW decoder (castforecast/raw.py), against docs/gates/gate2-preregistration.md.

The decode tests run LibRaw on real linear DNG files written by tests/dng_helpers.py, the layout
Apple ProRAW uses, rather than on mocked postprocess output.
"""

from types import SimpleNamespace

import numpy as np
import pytest
import rawpy

from castforecast.raw import SETTINGS, Decoded, decode, region_mean, sensor_clipped
from tests.dng_helpers import linear_dng

WHITE = 16383


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
        "highlight_mode": rawpy.HighlightMode.Ignore,
        "adjust_maximum_thr": 0.0,
        "demosaic_algorithm": rawpy.DemosaicAlgorithm.AHD,
        "fbdd_noise_reduction": rawpy.FBDDNoiseReductionMode.Off,
        "median_filter_passes": 0,
        "bright": 1.0,
        "user_flip": 0,
    }


def _frame(value=10000):
    return np.full((32, 48, 3), value, np.uint16)


def test_white_balance_never_counts_as_clipping(tmp_path):
    # Codex review r1: samples at 61 percent of white with multipliers (2, 1, 1.5) used to come
    # out at full scale in red and were all marked clipped.
    d = decode(linear_dng(tmp_path / "wb.dng", _frame(10000)))
    assert not d.clipped.any()
    assert d.info["raw_type"] == "Stack"
    assert d.info["camera_whitebalance"][:3] == pytest.approx([2.0, 1.0, 1.5], rel=1e-5)


def test_balanced_output_keeps_the_channel_ratios(tmp_path):
    d = decode(linear_dng(tmp_path / "ratio.dng", _frame(10000)))
    r, g, b = d.rgb[10, 10]
    assert (r / g, b / g) == pytest.approx((2.0, 1.5), rel=1e-3)


def test_a_sample_at_the_white_level_in_one_channel_is_clipped(tmp_path):
    data = _frame(10000)
    data[0:4, 0:4] = WHITE  # all channels saturated
    data[20, 30, 0] = WHITE  # red only
    d = decode(linear_dng(tmp_path / "sat.dng", data))
    assert d.clipped[0:4, 0:4].all()
    assert d.clipped[20, 30]
    assert d.clipped.sum() == 17


def test_the_brightest_pixel_is_not_clipped_just_for_being_brightest(tmp_path):
    # With LibRaw's default adjust_maximum_thr (0.75), a frame peaking at 80 percent of white
    # would be rescaled so its brightest pixel lands at full scale.
    data = _frame(6000)
    data[5, 5] = 13000
    d = decode(linear_dng(tmp_path / "peak.dng", data))
    assert not d.clipped.any()
    assert d.rgb[5, 5, 1] / d.rgb[10, 10, 1] == pytest.approx(13000 / 6000, rel=1e-3)


def test_a_linearization_table_sets_the_saturation_level(tmp_path):
    # ProRAW stores 10-bit codes and a table; LibRaw hands back table values, so the table's top
    # (here 65472, below WhiteLevel 65535) is where a sample saturates.
    lut = np.arange(1024) * 64
    data = np.full((32, 48, 3), 600, np.uint16)
    data[3, 4, 1] = 1023
    d = decode(linear_dng(tmp_path / "lut.dng", data, white=65535, neutral=(1, 1, 1), lut=lut))
    assert d.info["saturation_level"] == 65472
    assert d.clipped.sum() == 1 and d.clipped[3, 4]


@pytest.mark.parametrize(
    ("kwargs", "why"),
    [
        # Codex review r2: LibRaw reported one white level (16000) for these per-channel levels,
        # so red samples at their 10000 ceiling were never marked.
        ({"white": (10000, 12000, 16000)}, "per-channel white"),
        # Codex review r2: with these black levels LibRaw reported white 16883, above the samples.
        ({"black": (1000, 500, 2000)}, "black level"),
    ],
)
def test_levels_the_decoder_cannot_trust_are_refused(tmp_path, kwargs, why):
    with pytest.raises(ValueError, match=why):
        decode(linear_dng(tmp_path / "odd.dng", _frame(9000), **kwargs))


def test_a_bayer_file_is_refused(tmp_path):
    # Codex review r2: AHD spreads a saturated site further than any fixed mask; only linear
    # DNGs (no interpolation) are decoded.
    cfa = np.full((32, 48), 6000, np.uint16)
    with pytest.raises(ValueError, match="linear DNG"):
        decode(linear_dng(tmp_path / "cfa.dng", cfa, photometric=32803))


def test_samples_above_the_saturation_level_are_a_mismatch_not_data():
    r = SimpleNamespace(raw_image_visible=np.full((2, 2, 4), 70000.0))
    with pytest.raises(ValueError, match="exceed"):
        sensor_clipped(r, 65535.0)


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

"""Tests for label-predicted catalogue entries (castforecast/label_catalogue.py)."""

import json

import numpy as np
import pytest

from castforecast.catalogue import MAX_RENDER_ERROR
from castforecast.label_catalogue import (
    LABELS,
    OUT,
    REFERENCE_L,
    RETAIL_ERROR_L,
    SKIN_LIGHTNESS,
    SKINS,
    _lightness,
    build,
    dumps,
    entry,
    label_render,
)
from castforecast.label_model import LIGHTNESS_RANGE, predict


def test_the_committed_catalogue_is_what_build_writes_from_the_pinned_labels():
    catalogue, left_out = build(LABELS)
    assert OUT.read_text() == dumps(catalogue), "run: python -m castforecast.label_catalogue"
    assert left_out == []


def test_every_pinned_label_is_zinc_oxide_only_and_inside_the_study_range():
    labels = json.loads(LABELS.read_text())["bottles"]
    assert len(labels) >= 5
    for b in labels:
        text = b["active_ingredient_text"].lower()
        assert "zinc oxide" in text and "titanium" not in text
        assert 5.0 <= b["zinc_oxide_pct"] <= 25.0
        assert str(b["zinc_oxide_pct"]).rstrip("0").rstrip(".") in text.replace(" ", "")


def test_the_reference_skins_sit_inside_the_studys_lightness_range():
    lo, hi = LIGHTNESS_RANGE
    assert all(lo <= lum <= hi for lum in SKIN_LIGHTNESS)
    # the sRGB matrix rounds Lab to linear RGB and back to within about 0.001 L*
    np.testing.assert_allclose(_lightness(SKINS), SKIN_LIGHTNESS, atol=0.01)


@pytest.mark.parametrize("zinc", [12.0, 16.0, 18.75, 20.0, 21.6, 24.08])
def test_each_render_as_sent_stays_within_the_bound_of_the_prediction(zinc):
    got = label_render(zinc)
    assert got["reachable"] is True
    assert got["render_error"] <= MAX_RENDER_ERROR
    assert got["paletteHex"] == "#ffffff"


def test_more_zinc_needs_a_stronger_blend():
    assert label_render(12.0)["blend"] < label_render(18.75)["blend"] < label_render(24.08)["blend"]


def test_a_render_that_misses_the_prediction_by_more_than_the_bound_is_unreachable():
    # Thinkbaby's 24 percent label lands at 1.007 L* once rounded to a whole colorIntensity.
    got = label_render(24.0)
    assert got["render_error"] > MAX_RENDER_ERROR
    assert got["reachable"] is False


def test_an_entry_carries_the_prediction_its_band_and_its_label():
    label = {
        "id": "x",
        "name": "N",
        "brand": "B",
        "upc": None,
        "set_id": "00000000-0000-4000-8000-000000000001",
        "label_effective": "20250213",
        "zinc_oxide_pct": 21.6,
    }
    e = entry(label)
    value = predict(21.6, REFERENCE_L)
    assert e["whitening"] == {
        "value": value,
        "low": value - RETAIL_ERROR_L,
        "high": value + RETAIL_ERROR_L,
        "unit": "L*",
    }
    assert e["evidence"] == {
        "source": "fda-label",
        "setId": label["set_id"],
        "labelEffective": "2025-02-13",
        "zincOxidePct": 21.6,
    }
    assert set(e["render"]) == {"paletteHex", "blend", "errorL"}


def test_a_label_outside_the_study_range_is_refused():
    with pytest.raises(ValueError, match="outside the study"):
        label_render(30.5)


def test_bottle_names_are_unique_because_the_chips_show_only_the_name():
    names = [b["name"] for b in json.loads(OUT.read_text())["bottles"]]
    assert len(names) == len(set(names))

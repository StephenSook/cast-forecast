"""Tests for label-predicted catalogue entries (castforecast/label_catalogue.py)."""

import json

import numpy as np
import pytest

from castforecast.catalogue import K1B_CURVE, MAX_RENDER_ERROR
from castforecast.k1_render import coverage_for_alpha
from castforecast.label_catalogue import (
    LABELS,
    OUT,
    REFERENCE_L,
    RETAIL_ERROR_L,
    SCHEMA_VERSION,
    SHOWN,
    SKINS,
    TONES,
    _lightness,
    _rendered,
    build,
    dumps,
    entry,
    tone_render,
)
from castforecast.label_model import LIGHTNESS_RANGE, predict

LABEL = {
    "id": "x",
    "name": "N",
    "brand": "B",
    "upc": None,
    "set_id": "00000000-0000-4000-8000-000000000001",
    "label_effective": "20250213",
    "zinc_oxide_pct": 21.6,
}


def test_the_committed_catalogue_is_what_build_writes_from_the_pinned_labels():
    catalogue, left_out = build(LABELS)
    assert OUT.read_text() == dumps(catalogue), "run: python -m castforecast.label_catalogue"
    assert left_out == []
    assert catalogue["schemaVersion"] == SCHEMA_VERSION
    assert [t["lStar"] for t in catalogue["tones"]] == list(TONES)


def test_the_published_file_does_not_depend_on_the_fits_last_bits():
    # CI's Linux and a Mac fit the label model to different last bits; the committed file must not differ.
    catalogue, _ = build(LABELS)

    def nudged(x):
        if isinstance(x, float):
            return x + abs(x) * 1e-12
        if isinstance(x, dict):
            return {k: nudged(v) for k, v in x.items()}
        if isinstance(x, list):
            return [nudged(v) for v in x]
        return x

    assert nudged(catalogue) != catalogue
    assert dumps(nudged(catalogue)) == dumps(catalogue)


def test_each_published_blend_still_sends_the_intensity_its_render_was_chosen_for():
    zinc = {b["id"]: b["zinc_oxide_pct"] for b in json.loads(LABELS.read_text())["bottles"]}
    for b in json.loads(OUT.read_text())["bottles"]:
        for t in b["tones"]:
            intensity, _, reachable = coverage_for_alpha(K1B_CURVE, t["render"]["blend"])
            chosen = tone_render(zinc[b["id"]], t["lStar"])["colorIntensity"]
            assert (intensity, reachable) == (chosen, True), (b["id"], t["lStar"])


def test_every_pinned_label_is_zinc_oxide_only_and_inside_the_study_range():
    labels = json.loads(LABELS.read_text())["bottles"]
    assert len(labels) >= 5
    for b in labels:
        text = b["active_ingredient_text"].lower()
        assert "zinc oxide" in text and "titanium" not in text
        assert 5.0 <= b["zinc_oxide_pct"] <= 25.0


def test_the_tones_sit_inside_the_studys_lightness_range_lighter_first():
    lo, hi = LIGHTNESS_RANGE
    assert all(lo <= t <= hi for t in TONES)
    assert list(TONES) == sorted(TONES, reverse=True)
    # the sRGB matrix rounds Lab to linear RGB and back to within about 0.001 L*
    np.testing.assert_allclose(_lightness(SKINS), TONES, atol=0.01)


@pytest.mark.parametrize("zinc", [12.0, 14.0, 16.0, 18.75, 20.0, 21.6, 24.0, 24.08])
@pytest.mark.parametrize("tone", TONES)
def test_each_tone_renders_as_sent_within_the_bound(zinc, tone):
    r = tone_render(zinc, tone)
    assert r is not None and r["errorL"] <= MAX_RENDER_ERROR
    # the stored blend is the shown blend of a whole intensity, and the route's inverse gives it back
    assert r["blend"] == pytest.approx(SHOWN[r["colorIntensity"]])
    intensity, shown, reachable = coverage_for_alpha(K1B_CURVE, r["blend"])
    assert (intensity, reachable) == (r["colorIntensity"], True)
    assert shown == pytest.approx(r["blend"])


def test_the_chosen_intensity_is_the_closest_whole_one():
    # Codex review of PR #8: a fitted blend rounded to 26 missed by 1.007 where 25 was within the bar.
    skin = SKINS[TONES.index(55.0)]
    errors = np.abs(_rendered(SHOWN, skin) - predict(24.0, 55.0))
    assert tone_render(24.0, 55.0)["colorIntensity"] == int(np.argmin(errors))


def test_more_zinc_needs_a_stronger_render_and_deeper_skin_whitens_more():
    assert (
        tone_render(12.0, 55.0)["blend"]
        < tone_render(18.75, 55.0)["blend"]
        < tone_render(24.08, 55.0)["blend"]
    )
    values = [t["whitening"]["value"] for t in entry(LABEL)["tones"]]
    assert values == sorted(values)  # lighter first, so whitening grows down the list


def test_an_entry_carries_per_tone_predictions_its_band_and_its_label():
    e = entry(LABEL)
    value = predict(21.6, REFERENCE_L)
    assert e["whitening"] == {
        "value": value,
        "low": value - RETAIL_ERROR_L,
        "high": value + RETAIL_ERROR_L,
        "unit": "L*",
    }
    assert [t["lStar"] for t in e["tones"]] == list(TONES)
    for t in e["tones"]:
        assert t["whitening"]["value"] == predict(21.6, t["lStar"])
        assert set(t["render"]) == {"paletteHex", "blend", "errorL"}
    assert e["evidence"] == {
        "source": "fda-label",
        "setId": LABEL["set_id"],
        "labelEffective": "2025-02-13",
        "zincOxidePct": 21.6,
    }


def test_a_tone_outside_the_study_or_an_unknown_tone_is_refused():
    with pytest.raises(ValueError):
        tone_render(30.5, 55.0)
    with pytest.raises(ValueError):
        tone_render(20.0, 40.0)  # not one of the five tones


def test_bottle_names_are_unique_because_the_chips_show_only_the_name():
    names = [b["name"] for b in json.loads(OUT.read_text())["bottles"]]
    assert len(names) == len(set(names))

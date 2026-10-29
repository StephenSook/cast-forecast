"""Tests for reading zinc oxide percentages from FDA labels (castforecast/fda_label.py)."""

import pytest

from castforecast.fda_label import zinc_oxide_pct


def label(text, substances=("ZINC OXIDE",)):
    return {"openfda": {"substance_name": list(substances)}, "active_ingredient": [text]}


@pytest.mark.parametrize(
    ("text", "want"),
    [
        ("Active ingredient Zinc Oxide (21.6%)", 21.6),
        ("Active Ingredient Uncoated Zinc Oxide 18.75%", 18.75),
        ("Active ingredient Zinc oxide 24.08% Purpose Sunscreen", 24.08),
        ("Active Ingredients Zinc Oxide 12%", 12.0),
    ],
)
def test_real_label_wordings_read_exactly(text, want):
    assert zinc_oxide_pct(label(text)) == want


def test_another_active_in_the_structured_list_is_refused():
    # Codex review of PR #8: a partial blacklist let "Padimate O 8%" through.
    with pytest.raises(ValueError, match="not exactly zinc oxide"):
        zinc_oxide_pct(label("Zinc Oxide 20% Padimate O 8%", ("ZINC OXIDE", "PADIMATE O")))


def test_a_second_concentration_in_the_text_is_refused():
    with pytest.raises(ValueError, match="one percentage"):
        zinc_oxide_pct(label("Zinc Oxide 20% Padimate O 8%"))


@pytest.mark.parametrize(
    "text",
    [
        "Zinc Oxide 10% to 20%",  # range, read as 10 before
        "Zinc Oxide 10-20%",
        "Zinc Oxide .5%",  # bare decimal, read as 5 before
        "Zinc Oxide -20%",  # sign, read as 20 before
        "Zinc Oxide 120%",
        "Zinc Oxide",
    ],
)
def test_malformed_or_ambiguous_percentages_are_refused(text):
    with pytest.raises(ValueError):
        zinc_oxide_pct(label(text))


def test_missing_structured_substances_are_refused():
    with pytest.raises(ValueError, match="not exactly zinc oxide"):
        zinc_oxide_pct({"active_ingredient": ["Zinc Oxide 20%"]})

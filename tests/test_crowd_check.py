"""Tests for the crowd check (castforecast/crowd_check.py), against
docs/gates/crowd-check-preregistration.md. Every review here is hand-written; no real review is used.
"""

import importlib.util
import json
import math
from pathlib import Path

import pytest

from castforecast.crowd_check import (
    MAX_REVIEWS,
    MIN_REVIEWS,
    PREDICTED_L55,
    analyse,
    average_ranks,
    bottle_counts,
    catalogue_l55,
    classify,
    dumps,
    is_english,
    main,
    matches,
    permutation_p,
    requested_asin,
    spearman,
    verdict,
)

ROOT = Path(__file__).resolve().parent.parent
ORDER = sorted(PREDICTED_L55, key=PREDICTED_L55.get)  # least predicted whitening first


def asin_of(i: int) -> str:
    return f"B0TEST{i:04d}"


def row(asin: str, title: str = "", body: str = "", rid: str | None = None, **extra) -> dict:
    r = {
        "input": f"https://www.amazon.com/dp/{asin}",
        "reviewTitle": title,
        "reviewDescription": body,
    }
    if rid:
        r["reviewId"] = rid
    r.update(extra)
    return r


def fixture(complaints: list[int], n: int = MIN_REVIEWS) -> tuple[list[dict], dict]:
    """n reviews per bottle in ORDER; the first complaints[i] of bottle i complain about cast."""
    rows, matched = [], []
    for i, bottle in enumerate(ORDER):
        a = asin_of(i)
        matched.append({"bottle": bottle, "asin": a})
        for j in range(n):
            body = "It leaves a white cast on me." if j < complaints[i] else "Nice and light."
            rows.append(row(a, "Review", body, rid=f"{a}-{j}"))
    return rows, {"matched": matched, "dropped": []}


# Lexicon -----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "white cast",
        "WHITE CAST",
        "white  cast",
        "whitecast",
        "white-cast",
        "a white residue",
        "white film",
        "white sheen",
        "white streak",
        "white streaks",
        "white tint",
        "leaves white",
        "leaves a white",
        "leaves me white",
        "leaves my skin white",
        "ghostly",
        "ghost",
        "ghost-like",
        "ashy",
        "ashen",
        "gray cast",
        "grey cast",
        "purple cast",
        "chalky",
        "pasty",
    ],
)
def test_every_lexicon_form_matches(text):
    assert matches(text), text


@pytest.mark.parametrize(
    "text",
    [
        "whitening",
        "a white bottle",
        "casts a shadow",
        "ghostwriter",
        "pastry",
        "ashley",
        "leaves your skin white",
        "white casting call",
        "blue cast",
    ],
)
def test_near_misses_do_not_match(text):
    assert matches(text) == [], text


def test_overlapping_entries_each_match():
    names = {name for name, _, _ in matches("it leaves white streaks")}
    assert names == {"leaves (a|me|my skin)? white", "white streak(s)"}


# Negation ----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "No white cast at all",
        "doesn't leave a white cast",
        "doesn" + chr(0x2019) + "t leave a white cast",  # curly apostrophe
        "does not leave a white cast",
        "did not leave any white cast",
        "totally free of white cast",
        "hardly any of that white cast",
        "Not one bit of white cast",
        "zero white cast",
        "without the ghostly look",
        "never chalky",
        "it isnt pasty",
    ],
)
def test_negated_mentions_are_mentions_but_not_complaints(text):
    assert classify(text) == (False, True), text


@pytest.mark.parametrize(
    "text",
    [
        "It leaves a slight white cast",
        "minimal white cast",
        "Not greasy at all but white cast",
        "I was told it would not be greasy and it leaves a white cast",
        "Love it. Leaves me white though",
    ],
)
def test_unnegated_mentions_are_complaints(text):
    assert classify(text) == (True, True), text


def test_one_unnegated_match_is_enough():
    # "No, I think it" negates "leaves a white"; "white cast" has "think it leaves a" before it.
    assert classify("No, I think it leaves a white cast") == (True, True)


def test_the_window_is_four_tokens():
    assert classify("no one two three white cast") == (False, True)
    assert classify("no one two three four white cast") == (True, True)


def test_a_two_word_negator_must_sit_wholly_inside_the_window():
    assert classify("free of a b c white cast") == (True, True)
    assert classify("free of a b white cast") == (False, True)


def test_no_lexicon_match_is_neither():
    assert classify("Great sunscreen, no smell.") == (False, False)


# Language ----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text, english",
    [
        ("Great product", True),
        ("Better than my old one", True),
        ("Love", True),
        ("Muy bueno, no deja la piel blanca", False),
        ("C'est tr" + chr(0xE8) + "s bien pour la peau", False),
        ("".join(chr(c) for c in (0x65E5, 0x713C, 0x3051, 0x6B62, 0x3081)), False),  # Japanese
        ("Gute Creme, sehr gut f" + chr(0xFC) + "r die Haut und nicht fettig", False),
    ],
)
def test_language_rule(text, english):
    assert is_english(text) is english


# Rows --------------------------------------------------------------------------------------------


def test_requested_asin_prefers_the_input_url():
    assert requested_asin(
        {"input": "https://www.amazon.com/dp/B0AAAAAAAA", "productAsin": "B0BBBBBBBB"}
    ) == ("B0AAAAAAAA")
    assert (
        requested_asin({"productOriginalAsin": "B0CCCCCCCC", "productAsin": "B0BBBBBBBB"})
        == "B0CCCCCCCC"
    )
    assert requested_asin({"productAsin": "B0BBBBBBBB"}) == "B0BBBBBBBB"
    assert requested_asin({}) is None


def test_bottle_counts_applies_each_rule_in_order():
    a = asin_of(0)
    rows = [row(a, error="NoReviews")]
    rows += [row(a, "t", "It has a white cast", rid="dup"), row(a, "t", "copy", rid="dup")]
    rows += [row(a, "", "", rid="empty")]
    rows += [row(a, "Muy bueno", "La piel queda muy bien con este producto", rid="es")]
    rows += [row(a, "No white cast", "Light.", rid=f"n{i}") for i in range(3)]
    c = bottle_counts(rows)
    assert c["rows_returned"] == 8
    assert c["error_records"] == 1
    assert c["duplicates_removed"] == 1
    assert c["beyond_cap"] == 0
    assert c["empty_texts"] == 1
    assert c["non_english"] == 1
    assert c["reviews_analysed"] == 4
    assert (c["complaint_count"], c["mention_count"]) == (1, 4)
    assert c["complaint_share"] == 0.25 and c["mention_share"] == 1.0
    assert c["complaint_terms"] == {"white cast": 1}


def test_bottle_counts_keeps_the_first_rows_up_to_the_cap():
    a = asin_of(0)
    rows = [row(a, "t", "fine", rid=f"r{i}") for i in range(MAX_REVIEWS)]
    rows += [row(a, "t", "white cast", rid=f"late{i}") for i in range(5)]
    c = bottle_counts(rows)
    assert c["beyond_cap"] == 5
    assert c["reviews_analysed"] == MAX_REVIEWS
    assert c["complaint_count"] == 0


def test_title_counts_as_text():
    c = bottle_counts([row(asin_of(0), "Chalky", "", rid="x")])
    assert (c["reviews_analysed"], c["complaint_count"]) == (1, 1)


# Statistics --------------------------------------------------------------------------------------


def test_average_ranks_share_ties():
    assert average_ranks([10, 20, 20, 30]) == [1, 2.5, 2.5, 4]
    assert average_ranks([3, 1, 2]) == [3, 1, 2]


def test_spearman_by_hand():
    # sum d^2 = 4 over n = 5: rho = 1 - 6 * 4 / (5 * 24) = 0.8
    assert spearman([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]) == pytest.approx(0.8)
    assert spearman([1, 2, 3], [3, 2, 1]) == pytest.approx(-1.0)
    assert spearman([1, 2, 3], [5, 5, 5]) is None


def test_exact_permutation_p_by_hand():
    # Permutations of 5 with sum d^2 <= 4: identity, 4 adjacent swaps, 3 pairs of disjoint ones.
    assert permutation_p([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]) == pytest.approx(8 / 120)
    assert permutation_p(list(range(8)), list(range(8))) == pytest.approx(1 / math.factorial(8))
    assert permutation_p([1, 2, 3], [7, 7, 7]) is None


def test_verdict_rule():
    assert verdict(8, 0.7, 0.01) == "SUPPORTED"
    assert verdict(8, 0.7, 0.05) == "SUPPORTED"
    assert verdict(8, 0.7, 0.0501) == "NOT SUPPORTED"
    assert verdict(8, -0.7, 0.01) == "NOT SUPPORTED"
    assert verdict(8, None, None) == "NOT SUPPORTED"
    assert verdict(5, 0.99, 0.001) == "NOT TESTABLE"


# Whole analysis ----------------------------------------------------------------------------------


def test_rising_complaints_are_supported():
    rows, amap = fixture([1, 2, 3, 4, 5, 6, 7, 8])
    out = analyse(rows, amap)
    assert out["n_measurable"] == 8
    assert out["primary"]["rho"] > 0.99
    # The two 16 percent bottles tie on prediction, so swapping their shares gives the same rho.
    assert out["primary"]["p_one_sided"] == pytest.approx(2 / math.factorial(8), abs=1e-6)
    assert out["primary"]["verdict"] == "SUPPORTED"
    # Every fixture review either complains or mentions nothing, so the two measures agree.
    assert out["secondary"]["rho"] == out["primary"]["rho"]


def test_falling_complaints_are_not_supported():
    rows, amap = fixture([8, 7, 6, 5, 4, 3, 2, 1])
    out = analyse(rows, amap)
    assert out["primary"]["rho"] < 0
    assert out["primary"]["verdict"] == "NOT SUPPORTED"


def test_flat_complaints_have_no_rho_and_are_not_supported():
    rows, amap = fixture([0] * 8)
    out = analyse(rows, amap)
    assert out["primary"]["rho"] is None
    assert out["primary"]["verdict"] == "NOT SUPPORTED"


def test_too_few_reviews_drops_a_bottle_and_too_few_bottles_is_not_testable():
    rows, amap = fixture([1, 2, 3, 4, 5, 6, 7, 8])
    short = {amap["matched"][0]["asin"], amap["matched"][1]["asin"], amap["matched"][2]["asin"]}
    rows = [r for r in rows if requested_asin(r) not in short or r["reviewId"].endswith("-0")]
    out = analyse(rows, amap)
    assert out["n_measurable"] == 5
    assert [d["bottle"] for d in out["dropped"]] == ORDER[:3]
    assert out["primary"]["verdict"] == "NOT TESTABLE"


def test_six_bottles_are_enough():
    rows, amap = fixture([1, 2, 3, 4, 5, 6, 7, 8])
    amap["dropped"] = [{"bottle": m["bottle"], "reason": "no listing"} for m in amap["matched"][:2]]
    amap["matched"] = amap["matched"][2:]
    out = analyse(rows, amap)
    assert out["n_measurable"] == 6
    assert out["primary"]["permutations"] == math.factorial(6)
    assert out["primary"]["verdict"] == "SUPPORTED"
    assert out["rows_not_assigned"] == 2 * MIN_REVIEWS


def test_each_bottle_needs_its_own_asin():
    _, amap = fixture([0] * 8)
    amap["matched"][1]["asin"] = amap["matched"][0]["asin"]
    with pytest.raises(ValueError):
        analyse([], amap)


def test_the_pinned_predictions_are_the_catalogue_at_l55():
    labels = json.loads((ROOT / "data" / "bottles" / "fda_labels.json").read_text())
    assert set(PREDICTED_L55) == {b["id"] for b in labels["bottles"]}
    live = catalogue_l55()
    for bottle, value in PREDICTED_L55.items():
        assert live[bottle] == pytest.approx(value, abs=1e-9), bottle


def test_the_output_is_publishable_as_is():
    spec = importlib.util.spec_from_file_location(
        "publish_results", ROOT / "scripts" / "publish_results.py"
    )
    pr = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pr)
    rows, amap = fixture([1, 2, 3, 4, 5, 6, 7, 8])
    text = dumps(analyse(rows, amap))
    clean, removed = pr.sanitize(json.loads(text))
    assert removed == []
    assert pr.dumps(clean) == text
    assert pr.forbidden_hits(text) == []


def test_main_writes_the_result_and_refuses_an_empty_file(tmp_path, capsys):
    rows, amap = fixture([1, 2, 3, 4, 5, 6, 7, 8])
    (tmp_path / "rows.json").write_text(json.dumps(rows))
    (tmp_path / "map.json").write_text(json.dumps(amap))
    assert (
        main([str(tmp_path / "rows.json"), str(tmp_path / "map.json"), str(tmp_path / "out.json")])
        == 0
    )
    assert json.loads((tmp_path / "out.json").read_text())["primary"]["verdict"] == "SUPPORTED"
    (tmp_path / "empty.json").write_text("[]")
    assert main([str(tmp_path / "empty.json"), str(tmp_path / "map.json")]) == 1
    capsys.readouterr()

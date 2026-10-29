"""Tests for the run 2 input adapter (castforecast/crowd_check_axesso.py), against
docs/gates/crowd-check-amendment-1.md. Every review here is hand-written; no real review is used.
"""

import json

from castforecast.crowd_check import MAX_REVIEWS, MIN_REVIEWS, PREDICTED_L55, analyse
from castforecast.crowd_check_axesso import adapt, is_found, main

ORDER = sorted(PREDICTED_L55, key=PREDICTED_L55.get)


def axesso_row(asin, title="", text="", rid=None, page=1, code=200, message="FOUND"):
    return {
        "statusCode": code,
        "statusMessage": message,
        "asin": asin,
        "currentPage": page,
        "sortStrategy": "recent",
        "reviewId": rid,
        "title": title,
        "text": text,
        "date": "Reviewed in the United States on 1 October 2026",
    }


def fixture(complaints, n=MIN_REVIEWS):
    rows, matched = [], []
    for i, bottle in enumerate(ORDER):
        asin = f"B0AXES{i:04d}"
        matched.append({"bottle": bottle, "asin": asin})
        for j in range(n):
            body = "It leaves a white cast on me." if j < complaints[i] else "Nice and light."
            rows.append(axesso_row(asin, "Review", body, rid=f"{asin}-{j}", page=j // 10 + 1))
    return rows, {"matched": matched, "dropped": []}


def test_fields_are_renamed_for_the_preregistered_analysis():
    (row,) = adapt([axesso_row("B0AXES0000", "Chalky", "Too white.", rid="R1")])
    assert row == {
        "productOriginalAsin": "B0AXES0000",
        "reviewId": "R1",
        "reviewTitle": "Chalky",
        "reviewDescription": "Too white.",
    }


def test_a_row_that_is_not_a_found_review_becomes_an_error_record():
    assert is_found(axesso_row("A"))
    assert not is_found(axesso_row("A", code=404, message="NOT_FOUND"))
    assert not is_found(axesso_row("A", code=200, message="NO_REVIEWS"))
    assert is_found({"asin": "A", "text": "x"})  # no status fields at all: a review
    (row,) = adapt([axesso_row("A", code=404, message="NOT_FOUND")])
    assert row["error"] == "404 NOT_FOUND"


def test_rows_are_put_in_page_order_so_the_cap_keeps_the_first_pages():
    asin = "B0AXES0000"
    late = [axesso_row(asin, "t", "white cast", rid=f"p11-{k}", page=11) for k in range(5)]
    early = [
        axesso_row(asin, "t", "fine", rid=f"r{k}", page=k // 10 + 1) for k in range(MAX_REVIEWS)
    ]
    adapted = adapt(late + early[::-1])
    assert [r["reviewId"] for r in adapted[-5:]] == [f"p11-{k}" for k in range(5)]
    amap = {"matched": [{"bottle": ORDER[0], "asin": asin}], "dropped": []}
    (entry,) = analyse(adapted, amap)["bottles"]
    assert entry["beyond_cap"] == 5
    assert entry["complaint_count"] == 0


def test_adapted_rows_give_the_same_analysis_as_the_original_actor_shape():
    rows, amap = fixture([1, 2, 3, 4, 5, 6, 7, 8])
    out = analyse(adapt(rows), amap)
    assert out["rows_not_assigned"] == 0
    assert out["n_measurable"] == 8
    assert out["primary"]["verdict"] == "SUPPORTED"
    same = [
        {
            "input": f"https://www.amazon.com/dp/{r['asin']}",
            "reviewId": r["reviewId"],
            "reviewTitle": r["title"],
            "reviewDescription": r["text"],
        }
        for r in rows
    ]
    assert analyse(same, amap) == out


def test_main_writes_the_result_and_refuses_an_empty_file(tmp_path, capsys):
    rows, amap = fixture([8, 7, 6, 5, 4, 3, 2, 1])
    (tmp_path / "rows.json").write_text(json.dumps(rows))
    (tmp_path / "map.json").write_text(json.dumps(amap))
    assert (
        main([str(tmp_path / "rows.json"), str(tmp_path / "map.json"), str(tmp_path / "o.json")])
        == 0
    )
    assert json.loads((tmp_path / "o.json").read_text())["primary"]["verdict"] == "NOT SUPPORTED"
    (tmp_path / "empty.json").write_text("[]")
    assert main([str(tmp_path / "empty.json"), str(tmp_path / "map.json")]) == 1
    capsys.readouterr()

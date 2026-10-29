"""Tests for which openFDA labels become bottles (castforecast/label_set.py) and the fetch script."""

import importlib.util
import json
from pathlib import Path

import pytest

from castforecast import label_set
from castforecast.label_set import (
    CATEGORY_REASONS,
    DUPLICATE,
    SCAN_REASONS,
    bottle_id,
    classify,
    display_brand,
    display_name,
    select,
)

ROOT = Path(__file__).resolve().parent.parent
_n = iter(range(1, 10_000))


def lab(
    text="Active ingredient Zinc Oxide 20%",
    *,
    name="Mineral Sunscreen SPF 30",
    labeler="Test Labeler, LLC",
    substances=("ZINC OXIDE",),
    product_type="HUMAN OTC DRUG",
    inactive="Water, Glycerin",
    elements="ZINC OXIDE WATER GLYCERIN",
    purpose="Sunscreen",
    eff="20250101",
    upcs=(),
    ndcs=("1111-001",),
    set_id=None,
):
    return {
        "set_id": set_id or f"{next(_n):08d}-0000-4000-8000-000000000000",
        "effective_time": eff,
        "active_ingredient": [text],
        "inactive_ingredient": [inactive],
        "spl_product_data_elements": [elements],
        "purpose": [purpose],
        "openfda": {
            "substance_name": list(substances),
            "product_type": [product_type],
            "brand_name": [name],
            "manufacturer_name": [labeler],
            "upc": list(upcs),
            "product_ndc": list(ndcs),
        },
    }


def reason(label, forms=("LOTION",)):
    return classify(label, list(forms))[0]


def test_a_plain_zinc_only_lotion_is_kept_with_its_percent():
    assert classify(lab(), ["LOTION"]) == (None, 20.0)


@pytest.mark.parametrize(
    ("label", "want"),
    [
        (lab(substances=("ZINC OXIDE", "TITANIUM DIOXIDE")), "not_zinc_only"),
        (lab(substances=()), "not_zinc_only"),
        (lab(product_type="HUMAN PRESCRIPTION DRUG"), "not_otc"),
        (lab(name="Diaper Rash Cream", purpose="Skin protectant"), "not_sunscreen"),
        (lab("Zinc Oxide 10% to 20%"), "unreadable_percent"),  # range
        (lab("Zinc Oxide 10-20%"), "unreadable_percent"),
        (lab("Zinc Oxide .20%"), "unreadable_percent"),  # bare decimal
        (lab("Zinc Oxide 12.0015%"), "unreadable_percent"),  # four decimals
        (lab("Zinc Oxide 20% Zinc Oxide 5%"), "unreadable_percent"),  # two percents
        (lab("Active ingredients"), "unreadable_percent"),  # title only
        (lab("Zinc Oxide 4%"), "outside_model_range"),
        (lab("Zinc Oxide 35%"), "outside_model_range"),
    ],
)
def test_the_scan_rules_refuse_in_order(label, want):
    assert reason(label) == want


@pytest.mark.parametrize(
    "label",
    [
        lab(inactive="Water, Iron Oxides (CI 77491, CI 77492, CI 77499)"),
        lab(inactive="Water, CI 77492"),
        lab(elements="ZINC OXIDE WATER FERRIC OXIDE RED"),
        lab(elements="ZINC OXIDE FERROSOFERRIC OXIDE"),
        lab(name="Tinted Mineral Sunscreen"),
    ],
)
def test_tinted_labels_are_left_out(label):
    assert reason(label) == "tinted"


def test_untinted_in_a_name_is_not_tinted():
    assert reason(lab(name="Untinted Mineral Sunscreen")) is None


def test_powders_are_left_out_by_dosage_form_or_name():
    assert reason(lab(), ["POWDER"]) == "powder"
    assert reason(lab(name="Mineral Sunscreen Powder")) == "powder"


def test_lip_products_are_left_out_by_dosage_form_or_name():
    assert reason(lab(), ["LIPSTICK"]) == "lip"
    assert reason(lab(name="Mineral Lip Balm")) == "lip"
    assert reason(lab(name="Eco Lips Zinc")) == "lip"
    assert reason(lab(name="Eclipse Mineral Sunscreen")) is None  # "lip" inside a word


def test_a_label_with_no_tone_render_is_left_out(monkeypatch):
    monkeypatch.setattr(label_set, "renders", lambda zinc: False)
    assert reason(lab()) == "render_error"


def test_every_percent_the_model_covers_renders_at_some_tone():
    assert label_set.renders(5.0) and label_set.renders(30.0)


def test_display_names_drop_claims_and_regulatory_wording():
    assert display_name("Coppertone Pure and Simple Sunscreen SPF 50") == (
        "Coppertone Pure and Simple Sunscreen"
    )
    assert display_name("Marine Screen Mineral Sunscreen Broad Spectrum SPF-30") == (
        "Marine Screen Mineral Sunscreen"
    )
    assert display_name("Daily Protect Mineral Sunscreen") == "Daily Mineral Sunscreen"
    assert display_name("Sport Water Resistant (80 Minutes) Lotion") == "Sport Lotion"
    assert display_name("365 WHOLE FOODS MARKET MINERAL SPF 50") == "365 Whole Foods Market Mineral"
    assert display_name("HEB MINERAL SUNSCREEN") == "HEB Mineral Sunscreen"
    assert display_name("Safe Sun Mineral") == "Sun Mineral"
    assert display_name("SPF 50") == "Zinc oxide sunscreen"
    assert len(display_name("Word " * 40)) <= 80


def test_display_names_carry_no_dash_but_the_hyphen_and_no_curly_quote():
    s = display_name("Sun — Bum’s “Best” Mineral – Lotion")
    assert "—" not in s and "–" not in s and "’" not in s and "“" not in s


def test_display_brands_drop_the_company_suffix_and_keep_the_trading_name():
    assert display_brand("Babo Botanicals, Inc.") == "Babo Botanicals"
    assert display_brand("Kenvue Brands LLC") == "Kenvue Brands"
    assert display_brand("Personal Best Products Inc. dba Zealios") == "Zealios"
    assert display_brand("Epic Etailers, LLC (DBA: Beauty by Earth)") == "Beauty by Earth"
    assert display_brand("PML NYC, LLC") == "PML NYC"
    assert len(display_brand("Name " * 30)) <= 60


def test_only_real_barcodes_are_listed():
    assert label_set.valid_upc("0816218029890")  # Supergoop Mineral Sheer Stick
    assert not label_set.valid_upc("0816218029891")  # check digit
    assert not label_set.valid_upc("0000000000000")  # a placeholder one label lists
    assert not label_set.valid_upc("12345")
    row = label_set.record(lab(upcs=("0816218029890", "0000000000000")), [], None, 20.0)
    assert row["upcs"] == ["0816218029890"] and row["upc"] == "0816218029890"


def test_ids_are_url_slugs_ending_in_the_set_id_prefix():
    assert bottle_id("Babo Botanicals Sheer Zinc", "08f0436b-85b6") == (
        "babo-botanicals-sheer-zinc-08f0436b"
    )
    assert len(bottle_id("x" * 200, "0123456789")) <= 64


FEATURED = {"00000000-0000-4000-8000-999999999999": ("my-bottle", "My Bottle", "Mine")}


def test_select_counts_every_record_once_and_keeps_featured_ids():
    star = lab(set_id="00000000-0000-4000-8000-999999999999", name="Star Sunscreen")
    labels = [
        star,
        lab(),
        lab(substances=("ZINC OXIDE", "OCTINOXATE")),
        lab(name="Tinted Sunscreen"),
        lab(name="Mineral Lip Balm"),
    ]
    counts, rows = select(labels, {"1111-001": "LOTION"}, FEATURED)
    assert counts["records"] == 5 and counts["kept"] == 2
    assert counts["not_zinc_only"] == 1 and counts["tinted"] == 1 and counts["lip"] == 1
    assert sum(counts[r] for r in (*SCAN_REASONS, *CATEGORY_REASONS, DUPLICATE, "kept")) == 5
    assert len(rows) == 4  # scan-rule refusals are counted, not listed
    assert rows[0]["id"] == "my-bottle" and rows[0]["featured"] is True  # featured first
    tinted = next(r for r in rows if r["excluded"] == "tinted")
    assert tinted["tinted"] is True and tinted["dosage_forms"] == ["LOTION"]


def test_select_refuses_a_run_that_leaves_a_featured_label_out():
    star = lab(set_id="00000000-0000-4000-8000-999999999999", name="Tinted Star")
    with pytest.raises(ValueError, match="featured labels left out"):
        select([star], {}, FEATURED)


def test_dedupe_keeps_the_newest_label_and_gathers_every_barcode():
    old = lab(eff="20240101", upcs=("0000000000017",), name="Mineral Sunscreen SPF 30")
    new = lab(eff="20250101", upcs=("0000000000024",), name="Mineral Sunscreen SPF 50")
    other_pct = lab("Zinc Oxide 15%", eff="20230101")
    counts, rows = select([old, new, other_pct], {}, {})
    kept = [r for r in rows if r["excluded"] is None]
    assert counts["duplicate"] == 1 and len(kept) == 2
    winner = next(r for r in kept if r["zinc_oxide_pct"] == 20.0)
    assert winner["set_id"] == new["set_id"]
    assert winner["upcs"] == ["0000000000017", "0000000000024"]
    assert winner["upc"] == "0000000000024"  # its own


def test_a_featured_label_wins_its_group_even_when_older():
    star = lab(set_id="00000000-0000-4000-8000-999999999999", eff="20200101")
    newer = lab(eff="20260101")
    _, rows = select([star, newer], {}, FEATURED)
    assert {r["set_id"]: r["excluded"] for r in rows} == {
        star["set_id"]: None,
        newer["set_id"]: DUPLICATE,
    }


def _fetch_module():
    spec = importlib.util.spec_from_file_location(
        "bottles_fetch_labels", ROOT / "analysis" / "bottles" / "fetch_labels.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_fetch_reads_every_cached_page_and_checks_the_total(tmp_path):
    mod = _fetch_module()

    def page(results, total):
        return {
            "meta": {"last_updated": "2026-10-28", "results": {"total": total}},
            "results": results,
        }

    first = [{"set_id": f"s{i:03d}"} for i in range(mod.PAGE)]
    (tmp_path / "label-00000.json").write_text(json.dumps(page(first, mod.PAGE + 1)))
    (tmp_path / "label-00100.json").write_text(json.dumps(page([{"set_id": "s999"}], mod.PAGE + 1)))
    results, meta = mod.fetch_all("label", "q", "set_id:asc", "set_id", str(tmp_path))
    assert len(results) == mod.PAGE + 1 and meta["last_updated"] == "2026-10-28"

    (tmp_path / "label-00100.json").write_text(json.dumps(page([{"set_id": "s001"}], mod.PAGE + 1)))
    with pytest.raises(SystemExit, match="distinct"):
        mod.fetch_all("label", "q", "set_id:asc", "set_id", str(tmp_path))


def test_the_committed_data_file_is_what_the_fetch_writes_and_its_counts_add_up():
    mod = _fetch_module()
    path = ROOT / "data" / "bottles" / "fda_labels.json"
    doc = json.loads(path.read_text())
    assert path.read_text() == mod.dumps(doc)
    counts = doc["counts"]
    assert (
        sum(counts[r] for r in (*SCAN_REASONS, *CATEGORY_REASONS, DUPLICATE, "kept"))
        == (counts["records"])
    )
    rows = doc["labels"]
    for r in (*CATEGORY_REASONS, DUPLICATE):
        assert counts[r] == sum(row["excluded"] == r for row in rows), r
    assert counts["kept"] == sum(row["excluded"] is None for row in rows)
    assert [r["set_id"] for r in rows if r["featured"]] == list(mod.FEATURED)
    assert all(r["excluded"] is None for r in rows if r["featured"])

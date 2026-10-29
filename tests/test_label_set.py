"""Tests for which openFDA labels become bottles (castforecast/label_set.py) and the fetch script."""

import importlib.util
import json
from pathlib import Path

import pytest

from castforecast import label_model, label_set
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


def test_a_percent_too_low_for_the_model_to_predict_any_cast_is_left_out():
    # The fit's intercept is below zero: under about 6.3 percent it predicts a darkening.
    cut = -label_model.A / label_model.C
    assert 6.0 < cut < 7.0
    assert reason(lab("Zinc Oxide 5%")) == "zinc_too_low"
    assert reason(lab("Zinc Oxide 6%")) == "zinc_too_low"
    assert reason(lab("Zinc Oxide 6.4%")) is None
    for tone in (65.0, 60.0, 55.0, 50.0, 45.0):
        assert label_model.predict(6.4, tone) > 0 > label_model.predict(6.0, tone)
    assert reason(lab("Zinc Oxide 5%", name="Tinted Sunscreen")) == "tinted"  # first rule wins


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


def test_a_label_breaking_two_rules_is_counted_under_the_first():
    tinted_lip = lab(name="Tinted Lip Balm", inactive="Iron Oxides")
    assert reason(tinted_lip, ["LIPSTICK"]) == "tinted"
    assert reason(lab(name="Tinted Sunscreen", substances=("ZINC OXIDE", "TITANIUM DIOXIDE"))) == (
        "not_zinc_only"
    )
    assert reason(lab("Zinc Oxide 40%", name="Tinted Sunscreen")) == "outside_model_range"
    assert reason(lab(name="Mineral Lip Powder"), ["POWDER"]) == "powder"


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
    # The number before "SPF", and a name left ending on a joining word.
    assert display_name("FORGE SKIN MINERAL TALLOW SUNSCREEN 30 SPF") == (
        "Forge Skin Mineral Tallow Sunscreen"
    )
    assert display_name("Thrive Bodyshield 50 SPF 50") == "Thrive Bodyshield"
    assert (
        display_name("Personalized Day Moisturizer with SPF 30") == "Personalized Day Moisturizer"
    )
    assert not display_name(("Coconut and " * 10).strip()).endswith(" and")


def test_display_names_carry_no_dash_but_the_hyphen_and_no_curly_quote():
    s = display_name("Sun — Bum’s “Best” Mineral – Lotion")
    assert "—" not in s and "–" not in s and "’" not in s and "“" not in s


def test_display_brands_drop_the_company_suffix_and_keep_the_trading_name():
    assert display_brand("Babo Botanicals, Inc.") == "Babo Botanicals"
    assert display_brand("Kenvue Brands LLC") == "Kenvue Brands"
    assert display_brand("Personal Best Products Inc. dba Zealios") == "Zealios"
    assert display_brand("Epic Etailers, LLC (DBA: Beauty by Earth)") == "Beauty by Earth"
    assert display_brand("PML NYC, LLC") == "PML NYC"
    assert display_brand("fmg Co.Ltd") == "fmg"
    assert display_brand("Environ Skin Care (PTY)") == "Environ Skin Care"
    assert display_brand("Atlantic Medical Products , LLC") == display_brand(
        "Atlantic Medical Products, LLC"
    )
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
    old = lab(eff="20240101", upcs=("0000000000017",), name="Mineral Sunscreen SPF 50")
    new = lab(eff="20250101", upcs=("0000000000024",), name="Mineral  Sunscreen SPF 50")
    other_pct = lab("Zinc Oxide 15%", eff="20230101")
    counts, rows = select([old, new, other_pct], {}, {})
    kept = [r for r in rows if r["excluded"] is None]
    assert counts["duplicate"] == 1 and len(kept) == 2
    winner = next(r for r in kept if r["zinc_oxide_pct"] == 20.0)
    assert winner["set_id"] == new["set_id"]
    assert winner["upcs"] == ["0000000000017", "0000000000024"]
    assert winner["upc"] == "0000000000024"  # its own


def test_dedupe_treats_two_spellings_of_one_labeler_as_one():
    a = lab(labeler="Atlantic Medical Products , LLC", eff="20240101")
    b = lab(labeler="Atlantic Medical Products, LLC", eff="20250101")
    counts, _ = select([a, b], {}, {})
    assert counts["duplicate"] == 1 and counts["kept"] == 1


def test_a_duplicate_does_not_hand_its_kept_label_a_sister_products_barcode():
    # An older Pure and Simple label lists the Kids barcode; the Kids label lists it as its own.
    kids_code, own_code = "0000000000017", "0000000000024"
    old = lab(eff="20240101", upcs=(kids_code, own_code), name="Pure Sunscreen SPF 50")
    new = lab(eff="20250101", name="Pure Sunscreen SPF 50")
    kids = lab(eff="20250101", upcs=(kids_code,), name="Pure Kids Sunscreen")
    _, rows = select([old, new, kids], {}, {})
    by_set = {r["set_id"]: r for r in rows}
    assert by_set[old["set_id"]]["excluded"] == DUPLICATE
    assert by_set[new["set_id"]]["upcs"] == [own_code]
    assert by_set[kids["set_id"]]["upcs"] == [kids_code]


# Codex review of PR #19: Coppertone Pure and Simple Baby lotion (08134b95, barcode 0072140028718) was merged into
# the line's aerosol (088b7152) for an equal zinc percent, so the lotion's barcode opened the aerosol's label.
def test_one_lines_lotion_aerosol_and_stick_are_separate_bottles_with_their_own_barcodes():
    name = "Coppertone Pure and Simple Baby Sunscreen SPF 50"
    lotion = lab(upcs=("0072140028718",), name=name, ndcs=("1-lotion",), eff="20251231")
    aerosol = lab(upcs=("0072140028817",), name=name, ndcs=("1-spray",), eff="20251231")
    stick = lab(upcs=("0086800112921",), name=name, ndcs=("1-stick",), eff="20251231")
    forms = {"1-lotion": "LOTION", "1-spray": "AEROSOL, SPRAY", "1-stick": "STICK"}
    counts, rows = select([lotion, aerosol, stick], forms, {})
    assert counts["duplicate"] == 0 and counts["kept"] == 3
    by_set = {r["set_id"]: r for r in rows}
    assert by_set[lotion["set_id"]]["upcs"] == ["0072140028718"]
    assert by_set[aerosol["set_id"]]["upcs"] == ["0072140028817"]
    assert by_set[stick["set_id"]]["upcs"] == ["0086800112921"]
    # One name each, with the form a shopper sees, and ids that follow the names.
    names = {r["set_id"]: r["name"] for r in rows}
    assert names[lotion["set_id"]] == "Coppertone Pure and Simple Baby Sunscreen Lotion"
    assert names[aerosol["set_id"]] == "Coppertone Pure and Simple Baby Sunscreen Spray"
    assert names[stick["set_id"]] == "Coppertone Pure and Simple Baby Sunscreen Stick"
    assert all(r["id"] == bottle_id(r["name"], r["set_id"]) for r in rows)


def test_an_spf_30_and_an_spf_50_with_equal_zinc_are_two_bottles():
    counts, _ = select([lab(name="Sheer Mineral SPF30"), lab(name="Sheer Mineral SPF50")], {}, {})
    assert counts["duplicate"] == 0 and counts["kept"] == 2


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


def test_the_committed_rows_are_what_the_current_rules_derive_from_their_own_fields():
    # The raw labels are not committed, but everything derived from a row's own fields is checked,
    # so a change to the naming or barcode rules cannot leave the data file stale under a green CI.
    rows = json.loads((ROOT / "data" / "bottles" / "fda_labels.json").read_text())["labels"]
    for r in rows:
        if not r["featured"]:
            base = display_name(r["label_name"])
            with_form = f"{base} {label_set.form_word(r['dosage_forms'])}"
            assert r["name"] == base or (r["excluded"] is None and r["name"] == with_form), r[
                "set_id"
            ]
            assert r["brand"] == display_brand(r["manufacturer"]), r["set_id"]
            assert r["id"] == bottle_id(r["name"], r["set_id"]), r["set_id"]
        assert all(label_set.valid_upc(u) for u in r["upcs"]), r["set_id"]
        assert r["upc"] is None or r["upc"] in r["upcs"], r["set_id"]
        assert (r["excluded"] == "tinted") <= r["tinted"], r["set_id"]
    # Kept labels are one product each: no two share labeler, label name, percent and dosage form.
    keys = [label_set.relabel_key(r) for r in rows if r["excluded"] is None]
    assert len(keys) == len(set(keys))
    # The lotion of Codex's report is its own kept label, with its own barcode.
    lotion = next(r for r in rows if r["set_id"].startswith("08134b95"))
    assert lotion["excluded"] is None and lotion["upcs"] == ["0072140028718"]
    assert not any("0072140028718" in r["upcs"] for r in rows if r["set_id"].startswith("088b7152"))

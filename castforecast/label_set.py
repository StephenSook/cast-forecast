"""Which openFDA labels become catalogue bottles, and why each other one does not.

Every label that analysis/bottles/fetch_labels.py pulls (openfda.substance_name has ZINC OXIDE)
goes through `classify`, which gives the first reason it is left out, or None when it is kept:

The four scan rules (2026-10-29 bottle scan):
- not_zinc_only: the structured active substances are not exactly ["ZINC OXIDE"]; the model
  knows zinc oxide only.
- not_otc: product_type is not HUMAN OTC DRUG.
- not_sunscreen: no sunscreen wording in the name, purpose, indications, principal display panel
  or active-ingredient text.
- unreadable_percent: castforecast.fda_label refuses the active-ingredient text (no percent, a
  range, two percents, a malformed number).
- outside_model_range: the percent is outside the zinc range the label model was fitted on.

Then the categories the model cannot speak for:
- tinted: iron oxides in the ingredients, or "tint" in the name. The model has no tint term, and
  iron oxides hide cast, so a tinted bottle's prediction would be wrong in a known direction.
- powder: a powder dosage form or "powder" in the name. The model was never tested on a powder.
- lip: a lipstick dosage form or "lip" in the name. The tones are skin tones, not lips.
- render_error: no tone has a render within the catalogue's bound (MAX_RENDER_ERROR, 1.0 L*), the
  same rule castforecast.label_catalogue applies.

Kept labels are then deduplicated: one per (labeler, display name, percent), the newest label
kept, so a size or an SPF number listed under its own label is one bottle. A featured bottle (one
of the eight the site shipped first, whose ids pages and films link to) always wins its group, and
a featured label left out by any rule is an error, never a silent drop.
"""

from __future__ import annotations

import re
import unicodedata

from castforecast.fda_label import zinc_oxide_pct
from castforecast.label_model import ZINC_RANGE

# In the order they are tried; a label is counted under the first that applies.
SCAN_REASONS = (
    "not_zinc_only",
    "not_otc",
    "not_sunscreen",
    "unreadable_percent",
    "outside_model_range",
)
CATEGORY_REASONS = ("tinted", "powder", "lip", "render_error")
REASONS = SCAN_REASONS + CATEGORY_REASONS
DUPLICATE = "duplicate"

_SUNSCREEN = re.compile(r"sunscreen|\bspf\b|sunburn|sun protection", re.IGNORECASE)
# Iron oxides as label text writes them (Iron Oxides, CI 77491/77492/77499) and as SPL product data
# writes them (FERRIC OXIDE RED/YELLOW, FERROSOFERRIC OXIDE).
_IRON = re.compile(
    r"iron\s+oxides?|\b(?:ci\s*)?7749[129]\b|ferric\s+oxide|ferrosoferric\s+oxide|ferrous\s+oxide",
    re.IGNORECASE,
)
_TINT_NAME = re.compile(r"\btint(?:ed|s)?\b", re.IGNORECASE)
_POWDER = re.compile(r"\bpowders?\b", re.IGNORECASE)
_LIP = re.compile(r"\blips?\b", re.IGNORECASE)


def _texts(label: dict, *fields: str) -> str:
    out = []
    for f in fields:
        v = label.get(f)
        out.extend(v if isinstance(v, list) else [v] if isinstance(v, str) else [])
    return " ".join(out)


def _openfda(label: dict, field: str) -> list[str]:
    return [s for s in ((label.get("openfda") or {}).get(field) or []) if isinstance(s, str)]


def brand_name(label: dict) -> str:
    return (_openfda(label, "brand_name") or [""])[0].strip()


def labeler(label: dict) -> str:
    return (_openfda(label, "manufacturer_name") or [""])[0].strip()


def is_sunscreen(label: dict) -> bool:
    text = " ".join(
        [
            brand_name(label),
            _texts(
                label,
                "purpose",
                "indications_and_usage",
                "package_label_principal_display_panel",
                "active_ingredient",
            ),
        ]
    )
    return bool(_SUNSCREEN.search(text))


def is_tinted(label: dict) -> bool:
    ingredients = _texts(label, "inactive_ingredient", "spl_product_data_elements")
    return bool(_IRON.search(ingredients) or _TINT_NAME.search(brand_name(label)))


def is_powder(label: dict, dosage_forms: list[str]) -> bool:
    return any("POWDER" in f.upper() for f in dosage_forms) or bool(
        _POWDER.search(brand_name(label))
    )


def is_lip(label: dict, dosage_forms: list[str]) -> bool:
    return any("LIPSTICK" in f.upper() for f in dosage_forms) or bool(
        _LIP.search(brand_name(label))
    )


def renders(zinc: float) -> bool:
    """True when at least one tone has a render within the catalogue's bound."""
    # Imported here: label_catalogue imports this module (for the reason names), and it loads
    # colour-science and the K1b curve, which the reasons above never need.
    from castforecast.label_catalogue import TONES, tone_render

    return any(tone_render(zinc, t) is not None for t in TONES)


def classify(label: dict, dosage_forms: list[str]) -> tuple[str | None, float | None]:
    """(first reason the label is left out or None, its zinc oxide percent when it could be read)."""
    substances = [s.strip().upper() for s in _openfda(label, "substance_name")]
    if substances != ["ZINC OXIDE"]:
        return "not_zinc_only", None
    if [t.strip().upper() for t in _openfda(label, "product_type")] != ["HUMAN OTC DRUG"]:
        return "not_otc", None
    if not is_sunscreen(label):
        return "not_sunscreen", None
    try:
        zinc = zinc_oxide_pct(label)
    except ValueError:
        return "unreadable_percent", None
    if not ZINC_RANGE[0] <= zinc <= ZINC_RANGE[1]:
        return "outside_model_range", zinc
    if is_tinted(label):
        return "tinted", zinc
    if is_powder(label, dosage_forms):
        return "powder", zinc
    if is_lip(label, dosage_forms):
        return "lip", zinc
    if not renders(zinc):
        return "render_error", zinc
    return None, zinc


# Wording dropped from display names: sun-protection claims and regulatory phrases are the label's
# words, not this site's, and the site shows appearance only. The label's own name stays in the data
# file and on DailyMed.
_DROP = [
    r"\bbroad[\s-]*spectrum\b",
    r"\bsun\s+protection\s+factor\b",
    r"\bspf\s*[-#:]?\s*\d+\s*\+?",
    r"\bspf\b",
    r"\bwater\s*(?:and\s+sweat\s+)?resistant\b(?:\s*\(?\s*\d+\s*min(?:utes)?\.?\s*\)?)?",
    r"\buva\s*(?:[/&+-]|and)?\s*uvb\b",
    r"\bsunburn\b",
    r"\bprotect(?:s|ion|ive|ing|or)?\b",
    r"\bsafe(?:r|st|ty)?\b",
]
_DROP_RE = re.compile("|".join(_DROP), re.IGNORECASE)
_SUFFIX = re.compile(
    r"[,\s]+(?:llc|l\.l\.c\.?|inc\.?|incorporated|co\.?|corp\.?|corporation|company|ltd\.?|limited"
    r"|l\.p\.?|lp|gmbh|s\.a\.?|pty)\.?$",
    re.IGNORECASE,
)


def _tidy(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    # No dashes but the hyphen, no curly quotes: the site's copy rules.
    s = s.replace("—", " ").replace("–", "-").replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"').replace("®", "").replace("™", "")
    s = re.sub(r"\(\s*\)|\[\s*\]", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" ,;:-/&+")
    letters = [c for c in s if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.8:
        s = " ".join(_title(w, i) for i, w in enumerate(s.split(" ")))
    return s


_SMALL = {"a", "an", "and", "by", "for", "in", "of", "on", "or", "the", "to", "with"}


def _title(word: str, at: int) -> str:
    """One word of an all-capitals name in title case. Short words stay capitals (HEB, NYC), unless
    they are small English words; a word with a digit stays as written."""
    low = word.lower()
    if any(ch.isdigit() for ch in word):
        return word
    if low in _SMALL:
        return low.capitalize() if at == 0 else low
    if sum(ch.isalpha() for ch in word) <= 3:
        return word
    return word.capitalize()


def display_name(label_name: str) -> str:
    """The label's brand name without claims or regulatory wording, at most 80 characters."""
    s = _tidy(_DROP_RE.sub(" ", label_name))
    s = re.sub(r"\s+", " ", s).strip(" ,;:-/&+")
    if len(s) > 80:
        s = s[:80].rsplit(" ", 1)[0].rstrip(" ,;:-/&+")
    return s or "Zinc oxide sunscreen"


_DBA = re.compile(r"\b(?:dba|d/b/a)\b[\s:.]*([^()]+)", re.IGNORECASE)


def display_brand(labeler_name: str) -> str:
    """The labeler (its trading name after "dba" when it gives one) without its company suffix, at most
    60 characters."""
    dba = _DBA.search(labeler_name)
    s = _tidy(_DROP_RE.sub(" ", dba.group(1) if dba else labeler_name))
    for _ in range(2):
        s = _SUFFIX.sub("", s).strip(" ,;:-/&+")
    if len(s) > 60:
        s = s[:60].rsplit(" ", 1)[0].rstrip(" ,;:-/&+")
    return s or "Unknown labeler"


def bottle_id(name: str, set_id: str) -> str:
    """A URL id: the name as a slug, then the label's set id prefix so two labels never share one."""
    slug = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")[:55].rstrip("-") or "label"
    return f"{slug}-{set_id[:8]}"


def valid_upc(code: str) -> bool:
    """A barcode worth listing: 8 to 14 digits, a GTIN check digit that holds, and not all zeros
    (a placeholder some labels carry)."""
    if not re.fullmatch(r"\d{8,14}", code) or not code.strip("0"):
        return False
    body = [int(c) for c in code[:-1]][::-1]
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(body))
    return (10 - total % 10) % 10 == int(code[-1])


def record(label: dict, dosage_forms: list[str], reason: str | None, zinc: float) -> dict:
    """The data-file row for a label that passed the scan rules (kept, or left out by a category)."""
    set_id = label["set_id"]
    eff = str(label.get("effective_time") or "")
    if not re.fullmatch(r"\d{8}", eff):
        raise ValueError(f"{set_id}: effective_time {eff!r} is not YYYYMMDD")
    upcs = sorted({u for u in _openfda(label, "upc") if valid_upc(u)})
    name = display_name(brand_name(label))
    return {
        "id": bottle_id(name, set_id),
        "name": name,
        "brand": display_brand(labeler(label)),
        "featured": False,
        "label_name": brand_name(label),
        "manufacturer": labeler(label),
        "upc": upcs[0] if len(upcs) == 1 else None,
        "upcs": upcs,
        "set_id": set_id,
        "label_effective": eff,
        "active_ingredient_text": " ".join(label.get("active_ingredient") or []).strip(),
        "zinc_oxide_pct": zinc,
        "dosage_forms": dosage_forms,
        "tinted": is_tinted(label),
        "excluded": reason,
    }


def select(
    labels: list[dict], forms_by_ndc: dict[str, str], featured: dict[str, tuple[str, str, str]]
) -> tuple[dict, list[dict]]:
    """(counts by reason, one row per label that passed the scan rules).

    `featured` maps a set id to its (id, name, brand); those rows keep that id and name, must end
    up kept, and come first in the order given. The other rows follow by set id."""
    counts = {"records": len(labels), **{r: 0 for r in (*REASONS, DUPLICATE)}, "kept": 0}
    rows = []
    for label in sorted(labels, key=lambda lab: lab["set_id"]):
        ndcs = _openfda(label, "product_ndc")
        forms = sorted({forms_by_ndc[n] for n in ndcs if n in forms_by_ndc})
        reason, zinc = classify(label, forms)
        if reason in SCAN_REASONS:
            counts[reason] += 1
            continue
        row = record(label, forms, reason, zinc)
        if row["set_id"] in featured:
            row["id"], row["name"], row["brand"] = featured[row["set_id"]]
            row["featured"] = True
        rows.append(row)
    dedupe(rows, set(featured))
    # Featured rows first, in the order given (the order of the site's chips), then by set id.
    order = {s: i for i, s in enumerate(featured)}
    rows.sort(key=lambda r: (order.get(r["set_id"], len(order)), r["set_id"]))
    for row in rows:
        counts[row["excluded"] or "kept"] += 1
    kept = [r for r in rows if r["excluded"] is None]
    missing = set(featured) - {r["set_id"] for r in kept}
    if missing:
        why = {r["set_id"]: r["excluded"] for r in rows if r["set_id"] in missing}
        raise ValueError(f"featured labels left out: {sorted(missing)} {why}")
    ids = [r["id"] for r in kept]
    if len(ids) != len(set(ids)):
        raise ValueError("two kept labels share an id")
    if sum(counts[r] for r in (*REASONS, DUPLICATE, "kept")) != counts["records"]:
        raise ValueError(f"counts do not add up: {counts}")
    return counts, rows


def dedupe(records: list[dict], featured: set[str]) -> None:
    """Marks all but one kept record per (labeler, display name, percent) as duplicates, in place.

    Two such labels show the same name and get the same prediction (it depends only on the percent),
    so the shopper sees one bottle. The kept one is the newest label, or the featured one; its
    `upcs` gains the duplicates' barcodes, so scanning any of them finds it. Its `upc` stays its own."""
    groups: dict[tuple, list[dict]] = {}
    for r in records:
        if r["excluded"] is None:
            # The name label_set would give it, also for a featured row shown under a shorter name.
            name = display_name(r["label_name"]).lower()
            key = (r["manufacturer"].lower(), name, r["zinc_oxide_pct"])
            groups.setdefault(key, []).append(r)
    for group in groups.values():
        group.sort(
            key=lambda r: (r["set_id"] in featured, r["label_effective"], r["set_id"]),
            reverse=True,
        )
        if sum(r["set_id"] in featured for r in group) > 1:
            raise ValueError(f"two featured labels are duplicates: {[r['set_id'] for r in group]}")
        for r in group[1:]:
            r["excluded"] = DUPLICATE
        group[0]["upcs"] = sorted({u for r in group for u in r["upcs"]})

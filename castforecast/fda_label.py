"""Read a zinc oxide percentage from an openFDA drug label, refusing anything ambiguous.

A label is accepted only when its structured active substances (openfda.substance_name) are
exactly ZINC OXIDE, and its active-ingredient text holds exactly one percentage, written as a
plain positive number of one or two digits with up to three decimals. Ranges ("10% to 20%"),
signs, bare decimals (".5%") and second concentrations are refused, never read as a number.
"""

from __future__ import annotations

import re

# Every percentage-like token, loose on purpose, so malformed ones are seen and refused.
_TOKEN = re.compile(r"[-+]?\d*\.?\d+\s*%")
_PLAIN = re.compile(r"^\d{1,2}(?:\.\d{1,3})?$")
_RANGE = re.compile(r"\d\s*(?:%\s*)?(?:to|-|–|—)\s*\d", re.IGNORECASE)


def zinc_oxide_pct(label: dict) -> float:
    """The label's zinc oxide percentage; ValueError for any label this cannot read exactly."""
    substances = (label.get("openfda") or {}).get("substance_name") or []
    if [s.strip().upper() for s in substances] != ["ZINC OXIDE"]:
        raise ValueError(f"active substances are not exactly zinc oxide: {substances!r}")
    text = " ".join(label.get("active_ingredient") or []).strip()
    if "zinc oxide" not in text.lower():
        raise ValueError(f"active-ingredient text does not name zinc oxide: {text!r}")
    if _RANGE.search(text):
        raise ValueError(f"active-ingredient text holds a range: {text!r}")
    tokens = [t.replace("%", "").strip() for t in _TOKEN.findall(text)]
    if len(tokens) != 1:
        raise ValueError(f"expected one percentage, found {len(tokens)}: {text!r}")
    if not _PLAIN.match(tokens[0]):
        raise ValueError(f"malformed percentage {tokens[0]!r}: {text!r}")
    return float(tokens[0])

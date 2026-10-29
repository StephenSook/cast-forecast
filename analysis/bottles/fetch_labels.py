"""Fetch every zinc oxide sunscreen label from openFDA and write data/bottles/fda_labels.json.

Pulls every drug label whose structured active substances include ZINC OXIDE (openFDA mirrors
DailyMed's structured product labels), and the dosage form of every zinc oxide product in the
openFDA NDC directory, then sorts each label with castforecast.label_set: left out by a scan rule
(counted only), left out by a category the model cannot speak for or as a duplicate (listed, with
the reason), or kept. Each listed row keeps the active-ingredient text verbatim, so anyone can
check its percent against https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=...

Paginated at 100 a request, sorted by a stable key, about one request a second. With --cache DIR
each response page is saved there and read back on the next run, so a run can be repeated offline
against exactly the same responses.

Usage: python analysis/bottles/fetch_labels.py [--cache DIR] [out_json]
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import time
import urllib.parse
import urllib.request

# The eight bottles the site shipped first, by set id: (id, display name, brand). Pages, a film and
# the README link to these ids, so they never change; label_set refuses a run that drops one.
FEATURED = {
    "0d09b812-b3ca-4214-bed7-7e21ee3288b7": (
        "cetaphil-sheer-mineral-face",
        "Cetaphil Sheer Mineral",
        "Cetaphil",
    ),
    "08f0436b-85b6-5099-e063-6294a90a4c2e": (
        "babo-sheer-zinc",
        "Babo Sheer Zinc",
        "Babo Botanicals",
    ),
    "0beed72e-51df-d15a-e063-6394a90af559": (
        "supergoop-mineral-sheer-stick",
        "Supergoop Mineral Stick",
        "Supergoop",
    ),
    "14a9b605-f1f0-00e5-e063-6394a90a5a51": (
        "badger-face-mineral",
        "Badger Face Mineral",
        "Badger",
    ),
    "01cc205b-a345-262a-e063-6394a90a955c": (
        "hello-bello-mineral",
        "Hello Bello Mineral",
        "Hello Bello",
    ),
    "525f7bae-44b8-44e4-93ea-32995eca2566": (
        "neutrogena-sheer-zinc",
        "Neutrogena Sheer Zinc",
        "Neutrogena",
    ),
    "1062efb1-a638-4323-88f8-f2f98a5b996e": ("eltamd-uv-aox-mist", "EltaMD UV AOX Mist", "EltaMD"),
    "081484f8-58f5-f2a4-e063-6394a90a3379": (
        "coppertone-pure-and-simple",
        "Coppertone Pure and Simple",
        "Coppertone",
    ),
}
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "data", "bottles", "fda_labels.json")
sys.path.insert(0, ROOT)

from castforecast.label_set import select

API = "https://api.fda.gov/drug"
LABEL_QUERY = 'openfda.substance_name.exact:"ZINC OXIDE"'
NDC_QUERY = 'active_ingredients.name:"ZINC OXIDE"'
PAGE = 100
PAUSE_S = 1.0


def _get(url: str) -> dict:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                return json.load(r)
        except OSError as e:  # urllib.error.URLError and HTTPError are OSErrors
            if attempt == 3:
                raise SystemExit(f"{url}: {e}") from e
            time.sleep(5 * (attempt + 1))
    raise AssertionError("unreachable")


def fetch_all(
    endpoint: str, query: str, sort: str, key: str, cache: str | None
) -> tuple[list, dict]:
    """Every result for `query`, page by page; (results, meta of the first page)."""
    results, meta, skip = [], None, 0
    while True:
        path = os.path.join(cache, f"{endpoint}-{skip:05d}.json") if cache else None
        if path and os.path.exists(path):
            with open(path) as f:
                page = json.load(f)
        else:
            q = urllib.parse.quote(query)
            page = _get(f"{API}/{endpoint}.json?search={q}&sort={sort}&limit={PAGE}&skip={skip}")
            if path:
                with open(path, "w") as f:
                    json.dump(page, f)
            time.sleep(PAUSE_S)
        meta = meta or page["meta"]
        results.extend(page["results"])
        total = page["meta"]["results"]["total"]
        skip += PAGE
        if skip >= total:
            break
    keys = [r[key] for r in results]
    if len(results) != meta["results"]["total"] or len(set(keys)) != len(keys):
        raise SystemExit(
            f"{endpoint}: {len(results)} results, {len(set(keys))} distinct, total {total}"
        )
    return results, meta


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("out", nargs="?", default=OUT)
    p.add_argument("--cache", help="directory for raw response pages (reused when present)")
    a = p.parse_args(argv[1:])
    if a.cache:
        os.makedirs(a.cache, exist_ok=True)
    labels, meta = fetch_all("label", LABEL_QUERY, "set_id:asc", "set_id", a.cache)
    products, _ = fetch_all("ndc", NDC_QUERY, "product_id:asc", "product_id", a.cache)
    forms = {p["product_ndc"]: p["dosage_form"] for p in products if p.get("dosage_form")}
    counts, rows = select(labels, forms, FEATURED)
    doc = {
        "source": "openFDA drug label API (DailyMed SPL); dosage forms from the openFDA NDC directory",
        "query": LABEL_QUERY,
        "openfda_last_updated": meta["last_updated"],
        "retrieved": datetime.date.today().isoformat(),
        "counts": counts,
        "labels": rows,
    }
    with open(a.out, "w") as f:
        f.write(dumps(doc))
    print(json.dumps(counts))
    return 0


def dumps(doc: dict) -> str:
    """The data file: two-space JSON with one label per line, so a refetch diffs label by label."""
    head = {k: v for k, v in doc.items() if k != "labels"}
    body = json.dumps(head, indent=2)[:-2]
    rows = ",\n".join("    " + json.dumps(r) for r in doc["labels"])
    return f'{body},\n  "labels": [\n{rows}\n  ]\n}}\n'


if __name__ == "__main__":
    sys.exit(main(sys.argv))

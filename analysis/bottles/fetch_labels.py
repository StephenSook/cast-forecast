"""Fetch the FDA drug labels behind the catalogue and write data/bottles/fda_labels.json.

Each bottle is pinned by its label's set id (openFDA mirrors DailyMed's structured product
labels). castforecast.fda_label refuses a label unless its structured active substances are exactly
zinc oxide and its text holds one plain percentage; the script keeps the active-ingredient text
verbatim so anyone can check the number against
https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=...

Usage: python analysis/bottles/fetch_labels.py [out_json]
"""

from __future__ import annotations

import datetime
import json
import os
import sys
import time
import urllib.parse
import urllib.request

# set id -> (id, display name, brand): short unique names that lead with the brand and drop the SPF
# number and the regulatory wording; the label's own name is kept in label_name.
BOTTLES = {
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

from castforecast.fda_label import zinc_oxide_pct


def fetch(set_id: str) -> dict:
    q = urllib.parse.quote(f'set_id:"{set_id}"')
    with urllib.request.urlopen(
        f"https://api.fda.gov/drug/label.json?search={q}&limit=1", timeout=60
    ) as r:
        results = json.load(r)["results"]
    if len(results) != 1:
        raise SystemExit(f"{set_id}: expected one label, got {len(results)}")
    return results[0]


def main(argv: list[str]) -> int:
    out = argv[1] if len(argv) > 1 else OUT
    bottles = []
    for set_id, (bid, name, brand) in BOTTLES.items():
        label = fetch(set_id)
        actives = " ".join(label.get("active_ingredient", [])).strip()
        try:
            zinc = zinc_oxide_pct(label)
        except ValueError as e:
            raise SystemExit(f"{bid}: {e}") from e
        of = label.get("openfda", {})
        upcs = of.get("upc") or []
        bottles.append(
            {
                "id": bid,
                "name": name,
                "brand": brand,
                "label_name": (of.get("brand_name") or [""])[0],
                "manufacturer": (of.get("manufacturer_name") or [""])[0],
                "upc": upcs[0] if len(upcs) == 1 else None,
                "set_id": set_id,
                "label_effective": label.get("effective_time"),
                "active_ingredient_text": actives,
                "zinc_oxide_pct": zinc,
            }
        )
        time.sleep(0.3)
    doc = {
        "source": "openFDA drug label API (DailyMed SPL)",
        "retrieved": datetime.date.today().isoformat(),
        "bottles": bottles,
    }
    with open(out, "w") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    for b in bottles:
        print(
            f"{b['zinc_oxide_pct']:5.1f}  {b['brand']} {b['name']}  upc={b['upc']}  eff={b['label_effective']}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

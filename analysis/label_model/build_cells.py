"""Build data/plos2025/cells.csv from the PLOS ONE 2025 in vivo spreadsheet.

Source: Maldonado Lopez et al., PLOS ONE 2025 (doi 10.1371/journal.pone.0319891), raw data on
Mendeley Data (jfpzx7hcz2, version 2), CC BY 4.0. Fetch it with analysis/gate1/fetch_data.py.

Changes made (as the licence asks): each volunteer x formulation cell is reduced to the mean of
its replicate before/after pairs, and readings outside the 0 to 100 L* scale are dropped, the same
filter Gate 1 used (one reading, invivo.xlsx row 178). Nothing else is altered.

Usage: python analysis/label_model/build_cells.py [data_dir] [out_csv]
"""

from __future__ import annotations

import csv
import os
import statistics as st
import sys

import openpyxl

ZN = {
    "0% ZnO": 0.0,
    "5% ZnO": 5.0,
    "10% ZnO": 10.0,
    "20% ZnO": 20.0,
    "30% ZnO": 30.0,
    "14.7% ZnO Benchmark": 14.7,
}
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


def main(argv: list[str]) -> int:
    data = (
        argv[1]
        if len(argv) > 1
        else os.path.join(ROOT, "analysis", "gate1", "data", "plos2025_mendeley")
    )
    out = argv[2] if len(argv) > 2 else os.path.join(ROOT, "data", "plos2025", "cells.csv")
    ws = openpyxl.load_workbook(os.path.join(data, "invivo.xlsx"), data_only=True).worksheets[0]
    cells: dict = {}
    dropped = 0
    ff = [None, None, None]
    for r in list(ws.iter_rows(values_only=True))[1:]:
        if r[3] is None or r[4] is None:
            continue
        for i in range(3):
            if r[i] is not None:
                ff[i] = r[i]
        lb, la = float(r[3]), float(r[4])
        if not (0.0 <= lb <= 100.0 and 0.0 <= la <= 100.0):
            dropped += 1
            continue
        ita, vid, form = ff
        cells.setdefault((vid, form), {"ita": ita, "pairs": []})["pairs"].append((lb, la))
    rows = []
    for (vid, form), c in sorted(cells.items(), key=lambda kv: (kv[0][0], ZN[kv[0][1]])):
        lbs = [p[0] for p in c["pairs"]]
        dls = [p[1] - p[0] for p in c["pairs"]]
        rows.append(
            {
                "volunteer": vid,
                "ita": c["ita"],
                "formulation": form,
                "zinc_oxide_pct": ZN[form],
                "pairs": len(dls),
                "L_before": round(st.mean(lbs), 4),
                "dL": round(st.mean(dls), 4),
            }
        )
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {out}: {len(rows)} cells, {dropped} reading(s) dropped")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

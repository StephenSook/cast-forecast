"""Input adapter for crowd check run 2 (docs/gates/crowd-check-amendment-1.md).

Run 2 collects reviews with the Apify actor axesso_data/amazon-reviews-scraper, whose rows use
different field names from the actor the pre-registered analysis was written for. This module only
renames fields; every rule stays in castforecast/crowd_check.py, which is not changed.

Mapping, per axesso row:
  asin           -> productOriginalAsin (the ASIN the row was requested for)
  reviewId       -> reviewId
  title          -> reviewTitle
  text           -> reviewDescription
  statusCode and statusMessage -> error, when the row is not a found review (statusCode other than
                    200, or statusMessage other than "FOUND"), so it is counted as an error record
Rows are put in page order (stable sort on currentPage within the dataset order), so that "the
first rows in dataset order" means pages 1, 2, 3 ... of the sort the actor was asked for.

    python -m castforecast.crowd_check_axesso <axesso_rows_json> <asin_map_json> [out_json]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from castforecast.crowd_check import analyse, dumps


def _page(row: dict) -> float:
    page = row.get("currentPage")
    return float(page) if isinstance(page, int | float) else float("inf")


def is_found(row: dict) -> bool:
    code = row.get("statusCode")
    message = row.get("statusMessage")
    if code is not None and code != 200:
        return False
    return message is None or message == "FOUND"


def adapt(rows: list[dict]) -> list[dict]:
    """Rows in the field names castforecast/crowd_check.py reads, in page order."""
    out = []
    for row in sorted(rows, key=_page):
        new = {
            "productOriginalAsin": row.get("asin"),
            "reviewId": row.get("reviewId"),
            "reviewTitle": row.get("title") or "",
            "reviewDescription": row.get("text") or "",
        }
        if not is_found(row):
            new["error"] = f"{row.get('statusCode')} {row.get('statusMessage')}"
        out.append(new)
    return out


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) not in (2, 3):
        print(__doc__, file=sys.stderr)
        return 2
    rows = json.loads(Path(argv[0]).read_text())
    asin_map = json.loads(Path(argv[1]).read_text())
    if not isinstance(rows, list) or not rows:
        print("refused: the reviews file holds no rows", file=sys.stderr)
        return 1
    text = dumps(analyse(adapt(rows), asin_map))
    if len(argv) == 3:
        Path(argv[2]).write_text(text)
    print(text, end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())

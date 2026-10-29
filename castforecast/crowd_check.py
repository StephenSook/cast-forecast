"""Crowd check: do bottles with more predicted whitening get more Amazon reviews about white cast?

Pre-registered in docs/gates/crowd-check-preregistration.md, committed and pushed before any review
was fetched. Every rule below is that document's rule; change neither without saying so in a
separate commit.

Inputs
  - reviews JSON: the rows the Apify actor junglee/amazon-reviews-scraper wrote to its dataset
    (a list of objects; fields used: input, productOriginalAsin, productAsin, reviewId,
    reviewTitle, reviewDescription, error).
  - ASIN map JSON (docs/gates/crowd-check-asins.json):
    {"matched": [{"bottle": <catalogue id>, "asin": <ASIN>, ...}],
     "dropped": [{"bottle": <catalogue id>, "reason": <text>}]}

Per bottle: rows are assigned to the ASIN they were requested for; error records are not reviews;
duplicate reviewIds count once; at most the first 100 rows in dataset order are kept; empty texts
and non-English texts are excluded; what is left is "analysed". A bottle with fewer than
`MIN_REVIEWS` analysed reviews is dropped as unmeasurable.

Text analysed: the review title and body joined by a newline. A review is a cast COMPLAINT if at
least one lexicon match is not negated, and a cast MENTION if it has any lexicon match at all.

Statistic: Spearman rho (average ranks for ties) between the pinned predicted whitening at
L* 55 and the complaint share, with a one-sided exact permutation p over every permutation of the
share vector. SUPPORTED if rho > 0 and p <= 0.05; NOT SUPPORTED otherwise; NOT TESTABLE if fewer
than `MIN_BOTTLES` bottles are measurable. The mention share gets the same statistic, labelled
secondary, with no verdict of its own.

    python -m castforecast.crowd_check <reviews_json> <asin_map_json> [out_json]
"""

from __future__ import annotations

import itertools
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE = ROOT / "web" / "src" / "data" / "bottles.json"
REFERENCE_L = 55.0

# Predicted whitening (L*) at skin L* 55, copied from web/src/data/bottles.json when this file was
# pre-registered. The test is run on these numbers; tests check they still equal the catalogue.
PREDICTED_L55 = {
    "cetaphil-sheer-mineral-face": 2.184193,
    "babo-sheer-zinc": 3.717068,
    "supergoop-mineral-sheer-stick": 3.717068,
    "badger-face-mineral": 4.770919,
    "hello-bello-mineral": 5.249942,
    "neutrogena-sheer-zinc": 5.863092,
    "eltamd-uv-aox-mist": 2.95063,
    "coppertone-pure-and-simple": 6.813474,
}

MAX_REVIEWS = 100  # per ASIN, first rows in dataset order (the actor was asked for sort "recent")
MIN_REVIEWS = 20  # analysed reviews a bottle needs to be measurable
MIN_BOTTLES = 6  # measurable bottles the test needs, else NOT TESTABLE
ALPHA = 0.05
NEGATION_WINDOW = 4  # tokens before a match

# Case-insensitive, word-boundary lexicon. Whitespace between words is one or more spaces.
LEXICON = (
    ("white cast", r"\bwhite\s+cast\b"),
    ("whitecast", r"\bwhitecast\b"),
    ("white-cast", r"\bwhite-cast\b"),
    ("white residue", r"\bwhite\s+residue\b"),
    ("white film", r"\bwhite\s+film\b"),
    ("white sheen", r"\bwhite\s+sheen\b"),
    ("white streak(s)", r"\bwhite\s+streaks?\b"),
    ("white tint", r"\bwhite\s+tint\b"),
    ("leaves (a|me|my skin)? white", r"\bleaves\s+(?:(?:a|me|my\s+skin)\s+)?white\b"),
    ("ghostly", r"\bghostly\b"),
    ("ghost(-like)?", r"\bghost(?:-like)?\b"),
    ("ashy", r"\bashy\b"),
    ("ashen", r"\bashen\b"),
    ("gr(a|e)y cast", r"\bgr[ae]y\s+cast\b"),
    ("purple cast", r"\bpurple\s+cast\b"),
    ("chalky", r"\bchalky\b"),
    ("pasty", r"\bpasty\b"),
)
_LEXICON_RE = tuple((name, re.compile(pat, re.IGNORECASE)) for name, pat in LEXICON)

NEGATORS_ONE = frozenset(
    {
        "no",
        "not",
        "zero",
        "without",
        "never",
        "doesn't",
        "doesnt",
        "didn't",
        "didnt",
        "isn't",
        "isnt",
        "wasn't",
        "wasnt",
        "none",
    }
)
NEGATORS_TWO = frozenset(
    {("does", "not"), ("did", "not"), ("free", "of"), ("barely", "any"), ("hardly", "any")}
)

# Tokens: runs of letters and digits, joined across an inner apostrophe (doesn't is one token).
TOKEN = re.compile(r"[^\W_]+(?:'[^\W_]+)*")
_APOSTROPHES = str.maketrans({chr(0x2019): "'", chr(0x2018): "'"})  # curly to straight

# Language: a review counts as English unless it shows evidence of another language.
# fmt: off
ENGLISH_MARKERS = frozenset((
    "the", "and", "is", "it", "this", "that", "my", "with", "for", "of", "to", "was", "but", "i",
    "you", "on", "have", "not", "very", "so", "it's", "in", "be", "are", "they", "its", "just",
    "or", "at", "an", "if", "would", "will",
))
FOREIGN_MARKERS = frozenset((
    # Spanish
    "el", "los", "las", "que", "es", "muy", "por", "para", "con", "una", "del", "pero", "mi", "y",
    "en", "este", "esta", "como", "producto", "piel", "bueno", "buena",
    # French
    "est", "et", "tr\u00e8s", "avec", "une", "des", "du", "pas", "je", "mais", "peau",
    # Portuguese
    "n\u00e3o", "muito", "uma", "pele", "\u00e9",
    # German
    "der", "das", "und", "ist", "nicht", "sehr", "mit", "haut",
))
# fmt: on


def normalize(text: str) -> str:
    """Curly apostrophes become straight ones, so both spellings of doesn't are one token."""
    return text.translate(_APOSTROPHES)


def tokens(text: str) -> list[str]:
    return TOKEN.findall(normalize(text).lower())


def is_english(text: str) -> bool:
    """False if under half the letters are a-z, or foreign markers outnumber English markers."""
    letters = [c for c in text if c.isalpha()]
    if letters and sum(c.isascii() for c in letters) * 2 < len(letters):
        return False
    toks = tokens(text)
    english = sum(t in ENGLISH_MARKERS for t in toks)
    foreign = sum(t in FOREIGN_MARKERS for t in toks)
    return foreign <= english


def is_negated(text: str, start: int) -> bool:
    """True if a negator sits within the `NEGATION_WINDOW` tokens before position `start`."""
    window = tokens(text[:start])[-NEGATION_WINDOW:]
    if any(t in NEGATORS_ONE for t in window):
        return True
    return any(pair in NEGATORS_TWO for pair in itertools.pairwise(window))


def matches(text: str) -> list[tuple[str, int, bool]]:
    """Every lexicon match as (lexicon entry, start, negated). Patterns are checked one by one."""
    text = normalize(text)
    out = []
    for name, pat in _LEXICON_RE:
        for m in pat.finditer(text):
            out.append((name, m.start(), is_negated(text, m.start())))
    return sorted(out, key=lambda x: (x[1], x[0]))


def classify(text: str) -> tuple[bool, bool]:
    """(complaint, mention): complaint if any match is not negated, mention if any match."""
    found = matches(text)
    return any(not neg for _, _, neg in found), bool(found)


def review_text(row: dict) -> str:
    title = (row.get("reviewTitle") or "").strip()
    body = (row.get("reviewDescription") or "").strip()
    return "\n".join(part for part in (title, body) if part)


_ASIN_IN_URL = re.compile(r"/dp/([A-Z0-9]{10})")


def requested_asin(row: dict) -> str | None:
    """The ASIN a row was requested for: from the input URL, else the actor's original ASIN."""
    m = _ASIN_IN_URL.search(row.get("input") or "")
    if m:
        return m.group(1)
    return row.get("productOriginalAsin") or row.get("productAsin") or None


def bottle_counts(rows: list[dict]) -> dict:
    """Counts for one ASIN's rows, in dataset order."""
    errors = [r for r in rows if r.get("error")]
    reviews = [r for r in rows if not r.get("error")]
    seen: set[str] = set()
    unique = []
    for r in reviews:
        rid = r.get("reviewId")
        if rid:
            if rid in seen:
                continue
            seen.add(rid)
        unique.append(r)
    kept = unique[:MAX_REVIEWS]
    texts = [review_text(r) for r in kept]
    non_empty = [t for t in texts if t]
    english = [t for t in non_empty if is_english(t)]
    flags = [classify(t) for t in english]
    complaints = sum(c for c, _ in flags)
    mentions = sum(m for _, m in flags)
    n = len(english)
    terms: dict[str, int] = {}
    for t in english:
        for name in {name for name, _, neg in matches(t) if not neg}:
            terms[name] = terms.get(name, 0) + 1
    return {
        "rows_returned": len(rows),
        "error_records": len(errors),
        "duplicates_removed": len(reviews) - len(unique),
        "beyond_cap": len(unique) - len(kept),
        "empty_texts": len(texts) - len(non_empty),
        "non_english": len(non_empty) - n,
        "reviews_analysed": n,
        "complaint_count": complaints,
        "complaint_share": round(complaints / n, 6) if n else None,
        "mention_count": mentions,
        "mention_share": round(mentions / n, 6) if n else None,
        "complaint_terms": dict(
            sorted(terms.items())
        ),  # reviews with a non-negated match, per entry
    }


def average_ranks(values: list[float]) -> list[float]:
    """1-based ranks; tied values share the mean of the ranks they span."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return ranks


def _pearson(a: list[float], b: list[float]) -> float | None:
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    da = [x - ma for x in a]
    db = [y - mb for y in b]
    saa = sum(x * x for x in da)
    sbb = sum(y * y for y in db)
    if saa == 0 or sbb == 0:
        return None
    return sum(x * y for x, y in zip(da, db, strict=True)) / math.sqrt(saa * sbb)


def spearman(x: list[float], y: list[float]) -> float | None:
    """Spearman rho as the Pearson correlation of average ranks; None if either side is constant."""
    return _pearson(average_ranks(x), average_ranks(y))


def permutation_p(x: list[float], y: list[float]) -> float | None:
    """One-sided exact p: share of all permutations of y whose rho is >= the observed rho."""
    observed = spearman(x, y)
    if observed is None:
        return None
    rx, ry = average_ranks(x), average_ranks(y)
    hits = total = 0
    for perm in itertools.permutations(ry):
        total += 1
        r = _pearson(rx, list(perm))
        if r is not None and r >= observed - 1e-9:
            hits += 1
    return hits / total


def _stat(x: list[float], y: list[float], with_verdict: bool) -> dict:
    """rho and p rounded for publication; the verdict is decided on the unrounded values."""
    rho = spearman(x, y)
    p = permutation_p(x, y)
    out = {
        "rho": None if rho is None else round(rho, 6),
        "p_one_sided": None if p is None else round(p, 6),
        "permutations": math.factorial(len(x)),
    }
    if with_verdict:
        out["verdict"] = verdict(len(x), rho, p)
    return out


def verdict(n: int, rho: float | None, p: float | None) -> str:
    if n < MIN_BOTTLES:
        return "NOT TESTABLE"
    if rho is not None and p is not None and rho > 0 and p <= ALPHA:
        return "SUPPORTED"
    return "NOT SUPPORTED"


def analyse(rows: list[dict], asin_map: dict, predicted: dict | None = None) -> dict:
    """The whole pre-registered analysis. `predicted` defaults to the pinned `PREDICTED_L55`."""
    predicted = PREDICTED_L55 if predicted is None else predicted
    matched = asin_map.get("matched", [])
    asins = [m["asin"] for m in matched]
    bottles = [m["bottle"] for m in matched]
    if len(set(asins)) != len(asins) or len(set(bottles)) != len(bottles):
        raise ValueError("each bottle needs its own ASIN")
    unknown = [b for b in bottles if b not in predicted]
    if unknown:
        raise ValueError(f"no pinned prediction for {unknown}")

    by_asin: dict[str, list[dict]] = {a: [] for a in asins}
    unassigned = 0
    for row in rows:
        a = requested_asin(row)
        if a in by_asin:
            by_asin[a].append(row)
        else:
            unassigned += 1

    per_bottle = []
    dropped = [dict(d) for d in asin_map.get("dropped", [])]
    for m in matched:
        counts = bottle_counts(by_asin[m["asin"]])
        entry = {
            "bottle": m["bottle"],
            "asin": m["asin"],
            "predicted_whitening_l55": predicted[m["bottle"]],
            **counts,
        }
        entry["measurable"] = counts["reviews_analysed"] >= MIN_REVIEWS
        if not entry["measurable"]:
            dropped.append(
                {
                    "bottle": m["bottle"],
                    "reason": f"{counts['reviews_analysed']} analysed reviews, "
                    f"fewer than {MIN_REVIEWS}",
                }
            )
        per_bottle.append(entry)

    used = [e for e in per_bottle if e["measurable"]]
    x = [e["predicted_whitening_l55"] for e in used]
    out = {
        "test": "crowd check",
        "reference_skin_l": REFERENCE_L,
        "bottles": per_bottle,
        "dropped": dropped,
        "rows_not_assigned": unassigned,
        "n_measurable": len(used),
        "min_bottles": MIN_BOTTLES,
        "min_reviews": MIN_REVIEWS,
        "max_reviews": MAX_REVIEWS,
        "alpha": ALPHA,
        "lexicon": [name for name, _ in LEXICON],
        "negation_window_tokens": NEGATION_WINDOW,
    }
    if len(used) < MIN_BOTTLES:
        out["primary"] = {"measure": "complaint share", "verdict": "NOT TESTABLE"}
        out["secondary"] = {"measure": "mention share", "note": "not computed, too few bottles"}
        return out
    primary = _stat(x, [e["complaint_share"] for e in used], with_verdict=True)
    primary["measure"] = "complaint share"
    secondary = _stat(x, [e["mention_share"] for e in used], with_verdict=False)
    secondary["measure"] = "mention share (secondary, no verdict)"
    out["primary"] = primary
    out["secondary"] = secondary
    return out


def catalogue_l55(path: Path = CATALOGUE) -> dict[str, float]:
    """Whitening at skin L* 55 for every bottle in the catalogue, by bottle id."""
    data = json.loads(path.read_text())
    out = {}
    for b in data["bottles"]:
        tone = next(t for t in b["tones"] if t["lStar"] == REFERENCE_L)
        out[b["id"]] = tone["whitening"]["value"]
    return out


def dumps(obj: dict) -> str:
    """Same format as scripts/publish_results.py, so tests/test_published_results.py accepts it."""
    return json.dumps(obj, indent=1, sort_keys=True) + "\n"


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
    result = analyse(rows, asin_map)
    text = dumps(result)
    if len(argv) == 3:
        Path(argv[2]).write_text(text)
    print(text, end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())

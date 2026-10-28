"""Write a sanitized copy of a private gate-run JSON for publication in docs/gates/.

Usage:
    python scripts/publish_results.py recon/gate/k1b.json docs/gates/k1b-results.json

Removed (denylist):
  - selfie_a, selfie_b and a top-level selfie: local input file names
  - file_ids, result_url and every key ending in _id (task_id, file_id, ...): API identifiers
  - preflight bytes, width, height and short_side: size of the original, unresized photo
  - any string value that is an absolute path
Inside the strings that remain, absolute paths, URLs and id-like runs of 40 or more characters
are replaced by a marker (a task id quoted in an error message, for example).
Everything else, including every number, is copied unchanged. The script prints each removed
key path and refuses to write if the output still matches a forbidden pattern.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

DROP_TOP = {"selfie", "selfie_a", "selfie_b"}
DROP_ANYWHERE = {"file_ids", "result_url"}
PREFLIGHT_DROP = {"bytes", "width", "height", "short_side"}

ABS_PATH_VALUE = re.compile(r"^(?:/|~/|[A-Za-z]:[\\/])")
ABS_PATH_IN_TEXT = re.compile(
    r"(?<![\w.])(?:~/|/(?:Users|home|private|tmp|var|Volumes|opt|root)/|[A-Za-z]:\\)[^\s'\",)]*"
)
URL_IN_TEXT = re.compile(r"https?://\S+")
ID_RUN = re.compile(r"[A-Za-z0-9+/_=-]{40,}")

FORBIDDEN = [
    re.compile(r"task_id"),
    re.compile(r"file_id"),
    re.compile(r"https?://"),
    re.compile(r"/Users/|/home/"),
    re.compile(r"private_inputs"),
    re.compile(r"X-Amz", re.IGNORECASE),
    re.compile(r"sig="),
    ID_RUN,
]


def _drop_key(key: str, top: bool) -> bool:
    return (top and key in DROP_TOP) or key in DROP_ANYWHERE or key.endswith("_id")


def _clean_text(s: str) -> str:
    s = URL_IN_TEXT.sub("[url removed]", s)
    s = ABS_PATH_IN_TEXT.sub("[path removed]", s)
    return ID_RUN.sub("[id removed]", s)


def _clean_preflight(pf, path: str, removed: list[str]):
    if not isinstance(pf, dict):
        return pf
    if PREFLIGHT_DROP & pf.keys():
        out = {}
        for k, v in pf.items():
            if k in PREFLIGHT_DROP:
                removed.append(f"{path}/{k}")
            else:
                out[k] = _walk(v, f"{path}/{k}", removed, top=False)
        return out
    return {k: _clean_preflight(v, f"{path}/{k}", removed) for k, v in pf.items()}


def _walk(obj, path: str, removed: list[str], top: bool):
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            kp = f"{path}/{k}"
            if _drop_key(k, top) or (isinstance(v, str) and ABS_PATH_VALUE.match(v)):
                removed.append(kp)
            elif k == "preflight":
                out[k] = _clean_preflight(v, kp, removed)
            else:
                out[k] = _walk(v, kp, removed, top=False)
        return out
    if isinstance(obj, list):
        return [_walk(v, f"{path}[{i}]", removed, top=False) for i, v in enumerate(obj)]
    if isinstance(obj, str):
        if ABS_PATH_VALUE.match(obj):
            removed.append(path)
            return "[path removed]"
        cleaned = _clean_text(obj)
        if cleaned != obj:
            removed.append(f"{path} (redacted inside text)")
        return cleaned
    return obj


def sanitize(run: dict) -> tuple[dict, list[str]]:
    """Return (sanitized copy, removed key paths). The input is not modified."""
    removed: list[str] = []
    return _walk(run, "", removed, top=True), removed


def dumps(obj: dict) -> str:
    return json.dumps(obj, indent=1, sort_keys=True) + "\n"


def forbidden_hits(text: str) -> list[str]:
    return [p.pattern for p in FORBIDDEN if p.search(text)]


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    src, dest = Path(argv[0]), Path(argv[1])
    clean, removed = sanitize(json.loads(src.read_text()))
    text = dumps(clean)
    hits = forbidden_hits(text)
    if hits:
        print(f"refused: output still matches {hits}; nothing written", file=sys.stderr)
        return 1
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text)
    for r in removed:
        print(f"removed {r}")
    print(f"wrote {dest} ({len(removed)} removals)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

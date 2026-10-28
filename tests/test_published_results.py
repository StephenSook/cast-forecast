"""Every JSON published in docs/gates/ must be free of ids, URLs, local paths and photo sizes.

The patterns here are written independently of scripts/publish_results.py so a blind spot in
the publisher is not shared by this check.
"""

import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATES = ROOT / "docs" / "gates"
EXPECTED = {"k1b-results.json", "k2-results.json", "k1-results.json", "k1-attempt1-stop.json"}

FORBIDDEN = {
    "task_id": re.compile(r"task_id"),
    "file_id": re.compile(r"file_id"),
    "url": re.compile(r"https?://"),
    "home path": re.compile(r"/Users/|/home/"),
    "private_inputs": re.compile(r"private_inputs"),
    "X-Amz": re.compile(r"x-amz", re.IGNORECASE),
    "sig=": re.compile(r"sig="),
    "base64-like run": re.compile(r"[A-Za-z0-9+/=_-]{40,}"),
}
FORBIDDEN_KEYS = {"selfie", "selfie_a", "selfie_b", "file_ids", "result_url"}
PHOTO_SIZE_KEYS = {"bytes", "width", "height", "short_side"}


def _hits(text: str) -> list[str]:
    return [name for name, pat in FORBIDDEN.items() if pat.search(text)]


def _walk(obj, top=True):
    """Yield (key, value, is_top_level) for every dict entry."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k, v, top
            yield from _walk(v, top=False)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v, top=False)


def _bad_keys(data) -> set[str]:
    bad = set()
    for k, v, top in _walk(data):
        if k.endswith("_id") or k in FORBIDDEN_KEYS - {"selfie"} or (top and k == "selfie"):
            bad.add(k)
        if k == "preflight" and isinstance(v, dict):
            for sub in [v, *[x for x in v.values() if isinstance(x, dict)]]:
                bad |= PHOTO_SIZE_KEYS & sub.keys()
        if isinstance(v, str) and re.match(r"^(/|~/|[A-Za-z]:[\\/])", v):
            bad.add(k)
    return bad


def test_scanner_catches_planted_violations():
    for text in (
        '{"task_id": "x"}',
        '"file_id"',
        "http://x",
        "/Users/me/a.jpg",
        "private_inputs/selfies",
        "X-Amz-Signature",
        "?sig=abc",
        "Q" * 40,
    ):
        assert _hits(text), text
    assert _bad_keys({"selfie_a": "A.jpg", "r": [{"task_id": 1}]}) == {"selfie_a", "task_id"}
    assert _bad_keys({"preflight": {"A": {"bytes": 1, "ok": True}}}) == {"bytes"}
    assert _bad_keys({"x": "/tmp/a"}) == {"x"}
    assert _bad_keys({"renders": [{"selfie": "A", "id": "A_FFFFFF_ci0_cov0"}]}) == set()


def test_published_json_has_no_ids_urls_paths_or_photo_sizes():
    files = sorted(GATES.glob("*.json"))
    assert len(files) >= 3, f"only {len(files)} files scanned"  # never a vacuous pass
    assert EXPECTED <= {f.name for f in files}
    for f in files:
        text = f.read_text()
        assert _hits(text) == [], f"{f.name}: {_hits(text)}"
        assert _bad_keys(json.loads(text)) == set(), f.name


def test_published_json_is_a_fixed_point_of_the_publisher():
    spec = importlib.util.spec_from_file_location(
        "publish_results", ROOT / "scripts" / "publish_results.py"
    )
    pr = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pr)
    for f in sorted(GATES.glob("*.json")):
        text = f.read_text()
        clean, removed = pr.sanitize(json.loads(text))
        assert removed == [], f"{f.name}: {removed}"
        assert pr.dumps(clean) == text, f.name

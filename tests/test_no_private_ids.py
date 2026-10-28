"""Local-only guard: no YouCam file or task id from a private run file may appear in the repo.

The private run files (recon/gate/*.json) are gitignored, so in CI this test skips. Locally it
collects every id-like value under keys ending in _id or ids and checks that no 20-character
piece of any of them occurs in a tracked file or an untracked file git would pick up. Checking
pieces, not whole ids, also catches a truncated or partly edited copy of an id.
"""

import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
RUN_FILES = sorted((ROOT / "recon" / "gate").glob("*.json"))
WINDOW = 20


def _ids(obj, under_id_key=False):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from _ids(v, k.endswith(("_id", "ids")))
    elif isinstance(obj, list):
        for v in obj:
            yield from _ids(v, under_id_key)
    elif isinstance(obj, str) and under_id_key and len(obj) >= WINDOW:
        yield obj


def _repo_files() -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
        capture_output=True,
        check=True,
    ).stdout.decode()
    return [ROOT / p for p in out.split("\0") if p and (ROOT / p).is_file()]


def test_no_private_youcam_id_in_repo_files():
    if not RUN_FILES:
        pytest.skip("no private run files in recon/gate/ (CI has none); this guard runs locally")
    ids = {i for f in RUN_FILES for i in _ids(json.loads(f.read_text()))}
    assert len(ids) >= 1, "private run files exist but no ids were collected"
    pieces = {i[k : k + WINDOW]: i[:6] for i in ids for k in range(len(i) - WINDOW + 1)}
    files = _repo_files()
    assert len(files) >= 10, f"only {len(files)} repo files listed"
    hits = []
    for f in files:
        text = f.read_text(errors="ignore")
        found = {
            pieces[text[k : k + WINDOW]]
            for k in range(len(text) - WINDOW + 1)
            if text[k : k + WINDOW] in pieces
        }
        if found:
            # report the file and only the first 6 characters of each id
            hits.append(f"{f.relative_to(ROOT)}: ids starting {sorted(found)}")
    assert hits == [], "\n".join(hits)

"""Download the four PLOS ONE 2025 raw-data spreadsheets used by the Gate 1 analysis.

Source: Mendeley Data, dataset jfpzx7hcz2, version 2, the raw data for Maldonado Lopez et al.,
PLOS ONE 2025 (doi 10.1371/journal.pone.0319891). The spreadsheets are not redistributed in this
repository. Each download is checked against the SHA-256 of the copy the analysis was run on and
only then moved into place; a mismatch or a failed download keeps nothing.

Usage:
    python analysis/gate1/fetch_data.py [dest_dir]

dest_dir defaults to analysis/gate1/data/plos2025_mendeley, the folder heldout_test.py reads when
it is given no path.
"""

from __future__ import annotations

import hashlib
import http.client
import os
import sys
import tempfile
import urllib.request
from pathlib import Path

URL = "https://data.mendeley.com/public-files/datasets/jfpzx7hcz2/files/{file_id}/file_downloaded"
# local name: (Mendeley file id, SHA-256 of the copy the analysis was run on)
FILES = {
    "invivo.xlsx": (
        "0dabdf1a-9da2-41cc-b076-6c17b1932414",
        "48cda46b531ad637b8be3f0eaee770df42de5e1e04944eb755e0af03670dbdb6",
    ),
    "invitro.xlsx": (
        "6fb58a66-6a35-4e23-95e7-35e28d9fb8f2",
        "8a9cd409915cbb3b6978bf29304a1e6eb921c08bb2091a44d13d0dc70738de1a",
    ),
    "demographics.xlsx": (
        "a598d8b6-b8ac-4273-9bea-110d20f69ca3",
        "ef56716fa899f0de4e14f1f9ebb63ef743418ced1e802f7d66ca7761e2edb58b",
    ),
    "questionnaire.xlsx": (
        "f88b0006-dd59-4924-b240-0a84391cd3e2",
        "b57fcca674c3eac2291d4a749124dfad100f9ade37ad4ab686d478e85da455a4",
    ),
}
DEFAULT_DEST = Path(__file__).resolve().parent / "data" / "plos2025_mendeley"
USER_AGENT = "Mozilla/5.0 (compatible; cast-forecast gate1 fetch_data.py)"


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch_one(name: str, file_id: str, expected: str, dest_dir: Path) -> bool:
    dest = dest_dir / name
    if dest.exists():
        if sha256_of(dest.read_bytes()) == expected:
            print(f"ok: {name} already present with the pinned hash")
            return True
        print(f"warning: {name} has the wrong hash; deleting it before a verified download")
        dest.unlink()
    url = URL.format(file_id=file_id)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
    except (OSError, http.client.HTTPException) as exc:
        print(f"FAIL: {name}: download failed: {type(exc).__name__}", file=sys.stderr)
        return False
    got = sha256_of(data)
    if got != expected:
        print(f"FAIL: {name}: sha256 {got}, expected {expected}; not kept", file=sys.stderr)
        return False
    fd, tmp = tempfile.mkstemp(dir=dest_dir, suffix=".part")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, dest)
        tmp = ""
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)
    print(f"ok: wrote {dest} ({len(data)} bytes)")
    return True


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    dest_dir = Path(argv[0]) if argv else DEFAULT_DEST
    dest_dir.mkdir(parents=True, exist_ok=True)
    results = [fetch_one(n, fid, sha, dest_dir) for n, (fid, sha) in FILES.items()]
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())

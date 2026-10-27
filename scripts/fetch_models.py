"""Download the MediaPipe FaceLandmarker model to models/face_landmarker.task.

Source: Google's official MediaPipe model storage, as documented at
https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker (float16, version 1).
License: Apache-2.0 (MediaPipe models).
The download is verified against a pinned SHA-256 and the script fails loudly on mismatch.
"""

from __future__ import annotations

import hashlib
import sys
import urllib.request
from pathlib import Path

URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)
SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"
DEST = Path(__file__).resolve().parent.parent / "models" / "face_landmarker.task"


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    if DEST.exists() and sha256_of(DEST.read_bytes()) == SHA256:
        print(f"ok: {DEST} already present with pinned hash")
        return 0
    with urllib.request.urlopen(URL, timeout=60) as resp:
        data = resp.read()
    got = sha256_of(data)
    if got != SHA256:
        print(
            f"FAIL: sha256 mismatch for {URL}\n  expected {SHA256}\n  got      {got}",
            file=sys.stderr,
        )
        return 1
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_bytes(data)
    print(f"ok: wrote {DEST} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

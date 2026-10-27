"""Download the MediaPipe FaceLandmarker model to models/face_landmarker.task.

Source: Google's official MediaPipe model storage, as documented at
https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker (float16, version 1).
License: Apache-2.0 (MediaPipe models).
The download goes to a temp file beside the target, is verified against a pinned SHA-256, and only
then is moved into place with os.replace. A mismatch deletes the temp file and fails loudly. An
existing model with the wrong hash is reported and replaced by a verified download; an unverified
model is never left in place.
"""

from __future__ import annotations

import hashlib
import os
import sys
import tempfile
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
    if DEST.exists():
        if sha256_of(DEST.read_bytes()) == SHA256:
            print(f"ok: {DEST} already present with pinned hash")
            return 0
        print(f"warning: {DEST} has the wrong hash; replacing with a verified download")
    DEST.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=DEST.parent, suffix=".part")
    try:
        with os.fdopen(fd, "wb") as f, urllib.request.urlopen(URL, timeout=60) as resp:
            data = resp.read()
            f.write(data)
        got = sha256_of(data)
        if got != SHA256:
            print(
                f"FAIL: sha256 mismatch for {URL}\n  expected {SHA256}\n  got      {got}",
                file=sys.stderr,
            )
            return 1
        os.replace(tmp, DEST)
        tmp = ""
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)
    print(f"ok: wrote {DEST} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

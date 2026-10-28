import hashlib
import importlib.util
import io
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def _load():
    spec = importlib.util.spec_from_file_location(
        "fetch_models", ROOT / "scripts" / "fetch_models.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


@pytest.fixture
def fm(tmp_path, monkeypatch):
    mod = _load()
    monkeypatch.setattr(mod, "DEST", tmp_path / "models" / "face_landmarker.task")
    return mod


def test_wrong_hash_model_is_removed_before_download(fm, monkeypatch):
    fm.DEST.parent.mkdir()
    fm.DEST.write_bytes(b"tampered")
    seen = []

    def offline(url, timeout=None):
        seen.append(fm.DEST.exists())
        raise OSError("offline")

    monkeypatch.setattr(fm.urllib.request, "urlopen", offline)
    assert fm.main() != 0
    assert seen == [False]  # gone before the download started
    assert list(fm.DEST.parent.iterdir()) == []  # no model and no temp file left


def test_wrong_hash_download_leaves_nothing(fm, monkeypatch):
    monkeypatch.setattr(fm.urllib.request, "urlopen", lambda url, timeout=None: _Resp(b"bad"))
    assert fm.main() != 0
    assert list(fm.DEST.parent.iterdir()) == []


def test_verified_download_is_installed_once(fm, monkeypatch):
    payload = b"model bytes"
    calls = []

    def serve(url, timeout=None):
        calls.append(url)
        return _Resp(payload)

    monkeypatch.setattr(fm, "SHA256", hashlib.sha256(payload).hexdigest())
    monkeypatch.setattr(fm.urllib.request, "urlopen", serve)
    assert fm.main() == 0
    assert fm.DEST.read_bytes() == payload
    assert fm.main() == 0  # present with the pinned hash: nothing downloaded
    assert len(calls) == 1

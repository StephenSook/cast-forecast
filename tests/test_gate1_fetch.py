"""Offline tests for analysis/gate1/fetch_data.py (no network: urlopen is replaced)."""

import hashlib
import importlib.util
import io
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def _load():
    spec = importlib.util.spec_from_file_location(
        "gate1_fetch_data", ROOT / "analysis" / "gate1" / "fetch_data.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


GOOD = b"PK\x03\x04 spreadsheet bytes"


@pytest.fixture
def fd(monkeypatch):
    mod = _load()
    monkeypatch.setattr(mod, "FILES", {"invivo.xlsx": ("fid-1", hashlib.sha256(GOOD).hexdigest())})
    return mod


def test_pinned_file_ids_and_hashes_cover_the_four_spreadsheets():
    mod = _load()
    assert set(mod.FILES) == {
        "invivo.xlsx",
        "invitro.xlsx",
        "demographics.xlsx",
        "questionnaire.xlsx",
    }
    for file_id, sha in mod.FILES.values():
        assert len(file_id) == 36 and len(sha) == 64 and int(sha, 16) >= 0


def test_verified_download_is_written_once(fd, tmp_path, monkeypatch):
    seen = []

    def serve(req, timeout=None):
        seen.append(req.full_url)
        return _Resp(GOOD)

    monkeypatch.setattr(fd.urllib.request, "urlopen", serve)
    assert fd.main([str(tmp_path)]) == 0
    assert (tmp_path / "invivo.xlsx").read_bytes() == GOOD
    assert seen == [fd.URL.format(file_id="fid-1")]
    assert fd.main([str(tmp_path)]) == 0 and len(seen) == 1  # already verified: no download


def test_wrong_hash_download_keeps_nothing(fd, tmp_path, monkeypatch):
    monkeypatch.setattr(fd.urllib.request, "urlopen", lambda req, timeout=None: _Resp(b"other"))
    assert fd.main([str(tmp_path)]) == 1
    assert list(tmp_path.iterdir()) == []


def test_wrong_hash_file_is_removed_even_when_download_fails(fd, tmp_path, monkeypatch):
    (tmp_path / "invivo.xlsx").write_bytes(b"edited copy")

    def offline(req, timeout=None):
        raise OSError("offline")

    monkeypatch.setattr(fd.urllib.request, "urlopen", offline)
    assert fd.main([str(tmp_path)]) == 1
    assert list(tmp_path.iterdir()) == []

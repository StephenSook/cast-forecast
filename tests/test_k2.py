import json

import numpy as np
import pytest
from PIL import Image

from castforecast import k2_tone
from castforecast.color import apply_linear_gain, de2000, hex_to_lab
from castforecast.youcam import YouCamError

SKIN = (200, 150, 120)


def _hex(rgb):
    return "#" + "".join(f"{int(v):02X}" for v in rgb)


def _fake_patches(img):
    h, w = img.shape[:2]
    left = np.zeros((h, w), dtype=bool)
    right = np.zeros((h, w), dtype=bool)
    left[200:300, 100:200] = True
    right[200:300, 400:500] = True
    return {"left": left, "right": right, "scale_px": 300.0}


class FakeClient:
    def __init__(self, hexes, balances=(1000, 940), fail_on_call=None):
        self.hexes = list(hexes)
        self.balances = list(balances)
        self.fail_on_call = fail_on_call
        self.calls = []
        self.uploaded = []
        self.tone_calls = 0

    def balance(self):
        self.calls.append("balance")
        return self.balances.pop(0)

    def require_budget(self, min_units=200):
        self.calls.append(f"require_budget:{min_units}")
        return self.balances.pop(0)

    def upload(self, path):
        self.calls.append("upload")
        self.uploaded.append(path)
        return f"fid{len(self.uploaded)}"

    def run(self, endpoint, payload):
        self.tone_calls += 1
        self.calls.append(f"run:{endpoint}")
        self.payload = payload
        if self.fail_on_call == self.tone_calls:
            raise YouCamError(
                "task failed: error_lighting_dark", code="error_lighting_dark", task_id="tX"
            )
        return f"t{self.tone_calls}"

    def poll(self, endpoint, task_id, timeout_s=120):
        self.calls.append(f"poll:{task_id}")
        return {"color": {"skin_color": self.hexes.pop(0)}, "face_quality": {"ok": True}}


@pytest.fixture
def selfie(tmp_path):
    p = tmp_path / "selfies" / "A.jpg"
    p.parent.mkdir()
    Image.new("RGB", (600, 600), SKIN).save(p, "JPEG", quality=95)
    return p


@pytest.fixture(autouse=True)
def _patches(monkeypatch):
    monkeypatch.setattr(k2_tone, "cheek_patches", _fake_patches)


def test_k2_computes_metrics_from_fake_hexes(selfie, tmp_path):
    base = np.full((1, 1, 3), SKIN, dtype=np.uint8)
    orig_hex = _hex(SKIN)
    gain_hex = _hex(apply_linear_gain(base, 1.1)[0, 0])
    repeat_hex = "#C89779"  # one step off the original
    client = FakeClient([orig_hex, repeat_hex, gain_hex])
    out = tmp_path / "k2.json"
    code = k2_tone.run_k2(client, selfie, out, tmp_path / "copies")
    assert code == 0
    r = json.loads(out.read_text())
    assert r["units_spent"] == 60
    assert r["balance_before"] == 1000 and r["balance_after"] == 940
    assert client.calls[0] == "require_budget:200"
    assert client.tone_calls == 3
    assert client.payload["face_angle_strictness_level"] == "high"
    assert r["repeat_de"] == pytest.approx(de2000(hex_to_lab(orig_hex), hex_to_lab(repeat_hex)))
    assert r["repeat_de"] < 1.0
    assert r["api_vs_patch_de"] < 3.0
    assert r["gain_response_ratio"] == pytest.approx(1.0, abs=0.15)
    assert r["thresholds"] == {
        "repeat_de_max": 1.0,
        "gain_ratio_min": 0.7,
        "api_vs_patch_de_max": 3.0,
    }
    assert r["criteria_pass"] == {"repeat": True, "gain_response": True, "api_vs_patch": True}
    assert r["k2_pass"] is True
    assert [c["skin_color"] for c in r["calls"]] == [orig_hex, repeat_hex, gain_hex]
    assert r["calls"][0]["face_quality"] == {"ok": True}
    # every uploaded file is an upload_copy output, never the raw selfie
    assert all(p.name.endswith(".upload.jpg") for p in client.uploaded)
    assert selfie not in client.uploaded and len(client.uploaded) == 2


def test_k2_fails_when_api_ignores_gain(selfie, tmp_path):
    h = _hex(SKIN)
    client = FakeClient([h, h, h])
    out = tmp_path / "k2.json"
    assert k2_tone.run_k2(client, selfie, out, tmp_path / "c") == 0
    r = json.loads(out.read_text())
    assert r["gain_response_ratio"] == pytest.approx(0.0)
    assert r["criteria_pass"]["gain_response"] is False
    assert r["k2_pass"] is False


def test_k2_stops_after_first_api_error(selfie, tmp_path):
    client = FakeClient([_hex(SKIN)], balances=(1000, 980), fail_on_call=2)
    out = tmp_path / "k2.json"
    code = k2_tone.run_k2(client, selfie, out, tmp_path / "c")
    assert code != 0
    assert client.tone_calls == 2  # no third call, no retry of the failed one
    r = json.loads(out.read_text())
    assert r["error"] == {
        "code": "error_lighting_dark",
        "task_id": "tX",
        "message": "task failed: error_lighting_dark",
    }
    assert len(r["calls"]) == 1
    assert r["k2_pass"] is False
    assert r["units_spent"] == 20


def test_k2_refuses_unusable_selfie_before_any_call(tmp_path):
    bad = tmp_path / "tiny.jpg"
    Image.new("RGB", (100, 100)).save(bad)
    client = FakeClient([])
    out = tmp_path / "k2.json"
    assert k2_tone.run_k2(client, bad, out, tmp_path / "c") != 0
    assert client.calls == []
    assert json.loads(out.read_text())["error"]["code"] == "preflight"


def test_k2_no_face_makes_zero_calls(selfie, tmp_path, monkeypatch):
    monkeypatch.setattr(k2_tone, "cheek_patches", lambda img: None)
    client = FakeClient([])
    assert k2_tone.run_k2(client, selfie, tmp_path / "k2.json", tmp_path / "c") != 0
    assert client.calls == []

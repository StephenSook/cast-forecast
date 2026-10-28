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
    def __init__(self, hexes, balances=(1000, 940), fail_on_call=None, balance_fails=False):
        self.balance_fails = balance_fails
        self.endpoints = []
        self.file_ids = []
        self.hexes = list(hexes)
        self.balances = list(balances)
        self.fail_on_call = fail_on_call
        self.calls = []
        self.uploaded = []
        self.tone_calls = 0

    def balance(self):
        self.calls.append("balance")
        if self.balance_fails:
            raise YouCamError("network error: OSError", code="network")
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
        self.endpoints.append(("run", endpoint))
        self.file_ids.append(payload["src_file_id"])
        if self.fail_on_call == self.tone_calls:
            raise YouCamError(
                "task failed: error_lighting_dark", code="error_lighting_dark", task_id="tX"
            )
        return f"t{self.tone_calls}"

    def poll(self, endpoint, task_id, timeout_s=120):
        self.calls.append(f"poll:{task_id}")
        self.endpoints.append(("poll", endpoint))
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
    assert selfie not in client.uploaded and len(client.uploaded) == 3


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


GOOD = _hex(SKIN)
GAIN_HEX = _hex(apply_linear_gain(np.full((1, 1, 3), SKIN, dtype=np.uint8), 1.1)[0, 0])


def _run(tmp_path, selfie, client):
    out = tmp_path / "k2.json"
    code = k2_tone.run_k2(client, selfie, out, tmp_path / "c")
    return code, json.loads(out.read_text())


def test_k2_uses_exact_endpoint_for_run_and_poll(selfie, tmp_path):
    client = FakeClient([GOOD, GOOD, GAIN_HEX])
    _run(tmp_path, selfie, client)
    assert set(client.endpoints) == {
        ("run", "task/skin-tone-analysis"),
        ("poll", "task/skin-tone-analysis"),
    }


def test_k2_repeat_uses_fresh_upload_and_records_file_ids(selfie, tmp_path):
    client = FakeClient([GOOD, GOOD, GAIN_HEX])
    code, r = _run(tmp_path, selfie, client)
    assert code == 0
    assert len(set(client.file_ids)) == 3
    assert client.uploaded[0] == client.uploaded[1]  # same upload copy, uploaded twice
    assert r["file_ids"] == {"original": "fid1", "repeat": "fid2", "gain": "fid3"}
    assert [c["file_id"] for c in r["calls"]] == ["fid1", "fid2", "fid3"]


def test_k2_repeat_criterion_fails_alone(selfie, tmp_path):
    code, r = _run(tmp_path, selfie, FakeClient([GOOD, _hex((215, 150, 120)), GAIN_HEX]))
    assert code == 0
    assert r["criteria_pass"] == {"repeat": False, "gain_response": True, "api_vs_patch": True}
    assert r["k2_pass"] is False


def test_k2_api_vs_patch_criterion_fails_alone(selfie, tmp_path):
    off = np.full((1, 1, 3), (215, 150, 120), dtype=np.uint8)
    off_gain = _hex(apply_linear_gain(off, 1.1)[0, 0])
    code, r = _run(tmp_path, selfie, FakeClient([_hex((215, 150, 120))] * 2 + [off_gain]))
    assert code == 0
    assert r["criteria_pass"] == {"repeat": True, "gain_response": True, "api_vs_patch": False}
    assert r["k2_pass"] is False


def test_k2_near_zero_own_shift_leaves_ratio_undefined(selfie, tmp_path, monkeypatch):
    monkeypatch.setattr(k2_tone, "apply_linear_gain", lambda img, g: img)
    code, r = _run(tmp_path, selfie, FakeClient([GOOD, GOOD, GAIN_HEX]))
    assert code == 0
    assert r["gain_ratio_undefined"] is True
    assert "0.5" in r["gain_ratio_undefined_reason"]
    assert r["gain_response_ratio"] is None
    assert r["criteria_pass"]["gain_response"] is False
    assert r["k2_pass"] is False


def test_k2_balance_failure_after_calls_keeps_paid_results(selfie, tmp_path):
    client = FakeClient([GOOD, GOOD, GAIN_HEX], balance_fails=True)
    code, r = _run(tmp_path, selfie, client)
    assert code != 0
    assert [c["skin_color"] for c in r["calls"]] == [GOOD, GOOD, GAIN_HEX]
    assert [c["task_id"] for c in r["calls"]] == ["t1", "t2", "t3"]
    assert r["balance_before"] == 1000
    assert r["error"]["code"] == "network"
    assert r["k2_pass"] is False


def test_k2_malformed_hex_keeps_prior_calls_and_names_task(selfie, tmp_path):
    client = FakeClient([GOOD, "#12345", GAIN_HEX])
    code, r = _run(tmp_path, selfie, client)
    assert code != 0
    assert client.tone_calls == 2
    assert len(r["calls"]) == 1
    assert r["error"]["code"] == "bad_shape" and r["error"]["task_id"] == "t2"
    assert r["k2_pass"] is False


def test_k2_non_string_hex_is_bad_shape(selfie, tmp_path):
    code, r = _run(tmp_path, selfie, FakeClient([GOOD, 123456, GAIN_HEX]))
    assert code != 0 and r["error"]["code"] == "bad_shape"


def test_k2_error_path_records_balance_read_failure(selfie, tmp_path):
    client = FakeClient([GOOD], fail_on_call=2, balance_fails=True)
    code, r = _run(tmp_path, selfie, client)
    assert code != 0
    assert r["balance_after_error"] is True
    assert r["balance_after_error_code"] == "network"
    assert "balance_after" not in r
    assert r["error"]["code"] == "error_lighting_dark"


def test_k2_refuses_existing_results_file(selfie, tmp_path):
    out = tmp_path / "k2.json"
    out.write_text('{"earlier": true}')
    client = FakeClient([])
    assert k2_tone.run_k2(client, selfie, out, tmp_path / "c") != 0
    assert client.calls == []
    assert out.read_text() == '{"earlier": true}'
    assert not (tmp_path / "c").exists()  # nothing prepared either


def test_k2_main_refuses_before_the_client_is_built(tmp_path, monkeypatch):
    out = tmp_path / "recon" / "gate" / "k2.json"
    out.parent.mkdir(parents=True)
    out.write_text("{}")

    def no_client(*a, **k):
        raise AssertionError("the client (and the Keychain read) must not happen")

    monkeypatch.setattr(k2_tone, "YouCamClient", no_client)
    assert k2_tone.main(["--selfie", "A", "--root", str(tmp_path)]) != 0
    assert out.read_text() == "{}"

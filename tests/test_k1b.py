import json

import numpy as np
import pytest
from PIL import Image

from castforecast import k1_render
from castforecast import k1b_render as k1b
from castforecast.color import _decode, _encode
from castforecast.youcam import YouCamError

SKIN = (200, 150, 120)


def g_ci(cov, ci):
    return 0.36 * ci / 100.0  # depends on colorIntensity only


def _fake_patches(img):
    h, w = img.shape[:2]
    left = np.zeros((h, w), dtype=bool)
    right = np.zeros((h, w), dtype=bool)
    left[200:300, 100:200] = True
    right[200:300, 400:500] = True
    return {"left": left, "right": right, "scale_px": 300.0}


def _hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64) / 255.0


class FakeClient:
    def __init__(self, alpha_fn=g_ci, check_json=None, fail_on_run=None):
        self.alpha_fn = alpha_fn
        self.check_json = check_json
        self.fail_on_run = fail_on_run
        self.calls = []
        self.uploaded = []
        self.payloads = []
        self.balances = [1000, 981]
        self.results = {}

    def balance(self):
        return self.balances.pop(0)

    def require_budget(self, min_units=200):
        self.calls.append(f"require_budget:{min_units}")
        return self.balances.pop(0)

    def upload(self, path):
        self.calls.append("upload")
        self.uploaded.append(path)
        return f"fid{len(self.uploaded)}"

    def run(self, endpoint, payload):
        n = len(self.payloads)
        if self.check_json:
            self.check_json(n)
        if self.fail_on_run == n + 1:
            raise YouCamError("task failed: error_boom", code="error_boom", task_id="tX")
        self.payloads.append(payload)
        tid = f"t{n + 1}"
        src = self.uploaded[int(payload["src_file_id"][3:]) - 1]
        pal = payload["effects"][1]["palettes"][0]
        a = self.alpha_fn(pal["coverageIntensity"], pal["colorIntensity"])
        with Image.open(src) as im:
            lin = _decode(np.asarray(im.convert("RGB")).astype(np.float64) / 255.0)
        out = (1 - a) * lin + a * _decode(_hexrgb(pal["color"]))
        self.results[tid] = np.clip(np.rint(_encode(out) * 255.0), 0, 255).astype(np.uint8)
        return tid

    def poll(self, endpoint, task_id, timeout_s=120):
        return {"url": f"https://x/{task_id}.png"}

    def download(self, url, dest):
        arr = self.results[url.rsplit("/", 1)[1].split(".")[0]]
        Image.fromarray(arr).save(dest, "PNG")
        return dest


@pytest.fixture(autouse=True)
def _patches(monkeypatch):
    monkeypatch.setattr(k1_render, "cheek_patches", _fake_patches)


@pytest.fixture
def selfies(tmp_path):
    d = tmp_path / "selfies"
    d.mkdir()
    rng = np.random.default_rng(0)
    for name, base in (("A", SKIN), ("B", (180, 130, 105))):
        arr = np.clip(np.array(base) + rng.normal(0, 6, (600, 600, 3)), 0, 255).astype(np.uint8)
        Image.fromarray(arr).save(d / f"{name}.jpg", "JPEG", quality=95)
    return d / "A.jpg", d / "B.jpg"


def _run(client, selfies, tmp_path):
    out = tmp_path / "k1b.json"
    code = k1b.run_k1b(
        client,
        selfies[0],
        selfies[1],
        out,
        tmp_path / "copies",
        tmp_path / "renders",
        tmp_path / "contact.jpg",
    )
    return code, out


def test_ideal_dose_film_passes_all_five(selfies, tmp_path):
    client = FakeClient()
    code, out = _run(client, selfies, tmp_path)
    assert code == 0
    r = json.loads(out.read_text())
    assert len(client.payloads) == 19
    assert client.calls[0] == "require_budget:200"
    assert r["criteria_pass"] == {
        "monotonic": True,
        "r2": True,
        "capability": True,
        "inverse": True,
        "texture": True,
    }
    assert all(type(v) is bool for v in r["criteria_pass"].values())
    assert r["k1b_pass"] is True
    assert r["fit"]["r2"] > 0.99
    assert r["fit"]["g"]["100"] == pytest.approx(0.36, abs=2e-3)
    assert r["inverse_plan"][1]["target_alpha"] == 0.169
    assert all(p.name.endswith(".upload.jpg") for p in client.uploaded)
    first = r["renders"][0]
    for key in ("color", "colorIntensity", "coverageIntensity", "linear_rgb", "lab_mean"):
        assert key in first
    assert "hf_energy" in first and "g" in first
    assert all("predicted" in x and "observed" in x for x in r["texture"]["rows"])


def test_render_plan_is_exactly_the_preregistered_19(selfies, tmp_path):
    client = FakeClient()
    _run(client, selfies, tmp_path)
    pal = [
        (
            p["effects"][1]["palettes"][0]["color"],
            p["effects"][1]["palettes"][0]["colorIntensity"],
            p["effects"][1]["palettes"][0]["coverageIntensity"],
        )
        for p in client.payloads
    ]
    sweep = [("#FFFFFF", ci, cov) for cov in (0, 100) for ci in (0, 20, 40, 60, 80, 100)]
    gen = [(c, ci, 100) for c in ("#D2D2D2", "#BDBDBD") for ci in (40, 100)]
    assert sorted(pal[:16]) == sorted(sweep + gen)
    assert all(c == "#FFFFFF" and cov == 100 for c, _, cov in pal[16:])
    assert [p["effects"][1]["palettes"][0]["glowIntensity"] for p in client.payloads] == [0] * 19
    assert client.payloads[0]["effects"][0] == {
        "category": "skin_smooth",
        "skinSmoothStrength": 0,
        "skinSmoothColorIntensity": 0,
    }


def test_coverage_driven_fake_fails(selfies, tmp_path):
    client = FakeClient(alpha_fn=lambda cov, ci: 0.36 * cov / 100.0)
    code, out = _run(client, selfies, tmp_path)
    assert code == 0
    r = json.loads(out.read_text())
    assert r["criteria_pass"]["r2"] is False
    assert r["k1b_pass"] is False


def test_low_capability_fails(selfies, tmp_path):
    client = FakeClient(alpha_fn=lambda cov, ci: 0.2 * ci / 100.0)
    code, out = _run(client, selfies, tmp_path)
    assert code == 0
    r = json.loads(out.read_text())
    assert r["criteria_pass"]["capability"] is False
    assert r["k1b_pass"] is False


def test_unreachable_inverse_fails(selfies, tmp_path):
    client = FakeClient(alpha_fn=lambda cov, ci: 0.15 * ci / 100.0)
    code, out = _run(client, selfies, tmp_path)
    assert code == 0
    r = json.loads(out.read_text())
    assert r["criteria_pass"]["inverse"] is False
    assert r["criteria_reasons"]["inverse"] == "target alpha not reachable"
    assert r["k1b_pass"] is False


def test_exactly_one_failing_criterion_fails_k1b(selfies, tmp_path, monkeypatch):
    monkeypatch.setitem(k1b.THRESHOLDS, "capability_min", 0.99)
    code, out = _run(FakeClient(), selfies, tmp_path)
    assert code == 0
    r = json.loads(out.read_text())
    assert r["criteria_pass"] == {
        "monotonic": True,
        "r2": True,
        "capability": False,
        "inverse": True,
        "texture": True,
    }
    assert r["k1b_pass"] is False


def test_nan_distance_fails_inverse_gate():
    assert k1b.inverse_gate_ok(float("nan"), 2.0) is False
    assert k1b.inverse_gate_ok(1.9, 2.0) is True
    assert k1b.inverse_gate_ok(2.1, 2.0) is False


def test_monotonic_series_rules():
    def rec(cov, ci, l_val, status="ok"):
        return {
            "color": "#FFFFFF",
            "colorIntensity": ci,
            "coverageIntensity": cov,
            "status": status,
            "lab_mean": [l_val, 0, 0],
        }

    ok = [rec(c, ci, 60 + ci / 10) for c in (0, 100) for ci in (0, 20, 40, 60, 80, 100)]
    assert k1b.check_monotonic(ok)["pass"] is True
    one_missing = [x for x in ok if not (x["coverageIntensity"] == 0 and x["colorIntensity"] == 40)]
    assert k1b.check_monotonic(one_missing)["pass"] is True  # 5 of 6 incl ci100
    no100 = [x for x in ok if not (x["coverageIntensity"] == 0 and x["colorIntensity"] == 100)]
    assert k1b.check_monotonic(no100)["pass"] is False
    two_missing = [
        x for x in one_missing if not (x["coverageIntensity"] == 0 and x["colorIntensity"] == 20)
    ]
    assert k1b.check_monotonic(two_missing)["pass"] is False
    rev = [dict(x) for x in ok]
    rev[3]["lab_mean"] = [50, 0, 0]
    assert k1b.check_monotonic(rev)["pass"] is False


def test_json_persisted_per_render_and_19_calls(selfies, tmp_path):
    out = tmp_path / "k1b.json"
    seen = []

    def check(n):
        if n >= 1:
            d = json.loads(out.read_text())
            seen.append(len(d["renders"]) + len(d["inverse_renders"]))

    client = FakeClient(check_json=check)
    code, _ = _run(client, selfies, tmp_path)
    assert code == 0 and len(client.payloads) == 19
    assert seen == list(range(1, 19))


def test_error_mid_run_keeps_partial(selfies, tmp_path):
    client = FakeClient(fail_on_run=4)
    client.balances = [1000, 997]
    code, out = _run(client, selfies, tmp_path)
    assert code != 0
    assert len(client.payloads) == 3
    r = json.loads(out.read_text())
    assert len(r["renders"]) == 3 and r["error"]["code"] == "error_boom"
    assert r["balance_after"] == 997 and r["k1b_pass"] is False


def test_one_unusable_a_render_fails_r2_with_reason(selfies, tmp_path, monkeypatch):
    def patches(img):
        if tuple(img[0, 0]) == (1, 2, 3):
            return None
        return _fake_patches(img)

    class Hiding(FakeClient):
        def run(self, endpoint, payload):
            tid = super().run(endpoint, payload)
            pal = payload["effects"][1]["palettes"][0]
            if (pal["color"], pal["colorIntensity"], pal["coverageIntensity"]) == (
                "#FFFFFF",
                40,
                0,
            ):
                self.results[tid][0, 0] = (1, 2, 3)
            return tid

    monkeypatch.setattr(k1_render, "cheek_patches", patches)
    code, out = _run(Hiding(), selfies, tmp_path)
    assert code == 0
    r = json.loads(out.read_text())
    assert r["n_usable_a"] == 15
    assert r["criteria_pass"]["r2"] is False
    assert "all 16" in r["criteria_reasons"]["r2"]
    assert r["k1b_pass"] is False


def test_refuses_existing_results_file(selfies, tmp_path):
    out = tmp_path / "k1b.json"
    out.write_text('{"earlier": true}')
    client = FakeClient()
    code, _ = _run(client, selfies, tmp_path)
    assert code != 0
    assert client.calls == [] and client.payloads == []
    assert out.read_text() == '{"earlier": true}'


def test_refuses_existing_k1b_renders(selfies, tmp_path):
    rd = tmp_path / "renders"
    rd.mkdir()
    (rd / "A_FFFFFF_ci40_cov0.png").write_bytes(b"x")
    client = FakeClient()
    code, out = _run(client, selfies, tmp_path)
    assert code != 0
    assert client.calls == [] and not out.exists()


@pytest.mark.parametrize(
    "code,cls",
    [
        ("network", "infrastructure"),
        ("timeout", "infrastructure"),
        ("http_503", "infrastructure"),
        ("http_429", "infrastructure"),
        ("http_403", "content"),
        ("error_src_face_too_small", "content"),
        ("bad_download", "content"),
    ],
)
def test_stop_class(selfies, tmp_path, code, cls):
    class Failing(FakeClient):
        def run(self, endpoint, payload):
            if len(self.payloads) == 2:
                raise YouCamError("boom", code=code, task_id="tZ")
            return super().run(endpoint, payload)

    client = Failing()
    client.balances = [1000, 998]
    rc, out = _run(client, selfies, tmp_path)
    assert rc != 0
    r = json.loads(out.read_text())
    assert r["stop_class"] == cls and r["error"]["code"] == code


def test_texture_thresholds_come_from_k1b(selfies, tmp_path, monkeypatch):
    monkeypatch.setitem(k1b.THRESHOLDS, "texture_rel_tol", 1e-9)
    code, out = _run(FakeClient(), selfies, tmp_path)
    assert code == 0
    r = json.loads(out.read_text())
    assert r["criteria_pass"]["texture"] is False
    monkeypatch.setitem(k1b.THRESHOLDS, "texture_rel_tol", 0.20)
    monkeypatch.setitem(k1b.THRESHOLDS, "texture_min_fraction", 1.01)
    code, out2 = _run(FakeClient(), selfies, tmp_path / "again")
    assert json.loads(out2.read_text())["criteria_pass"]["texture"] is False


@pytest.mark.parametrize(
    "code,cls", [(503, "content"), (4001, "content"), (None, "content"), (b"network", "content")]
)
def test_stop_class_accepts_non_string_codes(code, cls):
    assert k1b.classify_stop(code) == cls


def test_non_string_error_code_mid_run_is_classified(selfies, tmp_path):
    class Failing(FakeClient):
        def run(self, endpoint, payload):
            if len(self.payloads) == 1:
                raise YouCamError("boom", code=4001, task_id="tZ")
            return super().run(endpoint, payload)

    client = Failing()
    client.balances = [1000, 999]
    rc, out = _run(client, selfies, tmp_path)
    assert rc != 0
    r = json.loads(out.read_text())
    assert r["stop_class"] == "content" and r["k1b_pass"] is False


def test_k1b_main_refuses_before_the_client_is_built(tmp_path, monkeypatch):
    out = tmp_path / "recon" / "gate" / "k1b.json"
    out.parent.mkdir(parents=True)
    out.write_text("{}")

    def no_client(*a, **k):
        raise AssertionError("the client (and the Keychain read) must not happen")

    monkeypatch.setattr(k1b, "YouCamClient", no_client)
    assert k1b.main(["--selfie", "A", "--check", "B", "--root", str(tmp_path)]) != 0
    assert out.read_text() == "{}"

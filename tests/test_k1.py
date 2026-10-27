import itertools
import json
import sys

import numpy as np
import pytest
from PIL import Image

from castforecast import k1_render as k1
from castforecast.color import _decode, _encode
from castforecast.youcam import YouCamError

SKIN = (200, 150, 120)


def true_alpha(cov, ci):
    return min(1.0, 0.8 * cov / 100.0) * (ci / 100.0) ** 0.5


def _fake_patches(img):
    h, w = img.shape[:2]
    if tuple(img[0, 0]) == (1, 2, 3):  # marker planted by FakeClient: pretend the face is hidden
        return None
    left = np.zeros((h, w), dtype=bool)
    right = np.zeros((h, w), dtype=bool)
    left[200:300, 100:200] = True
    right[200:300, 400:500] = True
    return {"left": left, "right": right, "scale_px": 300.0}


def _hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64) / 255.0


class FakeClient:
    def __init__(self, fail_on_run=None, hide=lambda p: False, check_json=None):
        self.calls = []
        self.uploaded = []
        self.payloads = []
        self.fail_on_run = fail_on_run
        self.hide = hide
        self.check_json = check_json  # callable(n_runs_so_far) run before each render
        self.balances = [1000, 958]
        self.results = {}

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
        assert endpoint == "task/makeup-vto"
        n = len(self.payloads)
        if self.check_json:
            self.check_json(n)
        if self.fail_on_run == n + 1:
            raise YouCamError("task failed: error_boom", code="error_boom", task_id="tX")
        self.payloads.append(payload)
        tid = f"t{n + 1}"
        src = self.uploaded[int(payload["src_file_id"][3:]) - 1]
        pal = payload["effects"][1]["palettes"][0]
        a = true_alpha(pal["coverageIntensity"], pal["colorIntensity"])
        with Image.open(src) as im:
            lin = _decode(np.asarray(im.convert("RGB")).astype(np.float64) / 255.0)
        out = (1 - a) * lin + a * _decode(_hexrgb(pal["color"]))
        arr = np.clip(np.rint(_encode(out) * 255.0), 0, 255).astype(np.uint8)
        if self.hide(pal):
            arr[0, 0] = (1, 2, 3)
        self.results[tid] = arr
        return tid

    def poll(self, endpoint, task_id, timeout_s=120):
        return {"url": f"https://x/{task_id}.png"}

    def download(self, url, dest):
        arr = self.results[url.rsplit("/", 1)[1].split(".")[0]]
        Image.fromarray(arr).save(dest, "PNG")
        return dest


@pytest.fixture(autouse=True)
def _patches(monkeypatch):
    monkeypatch.setattr(k1, "cheek_patches", _fake_patches)


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
    out = tmp_path / "k1.json"
    code = k1.run_k1(
        client,
        selfies[0],
        selfies[1],
        out,
        tmp_path / "copies",
        tmp_path / "renders",
        tmp_path / "contact.jpg",
    )
    return code, out


def _synth_renders(skin, alpha_fn):
    rs = []
    for color in k1.COLORS:
        p = k1._hex_linear(color)
        for ci in k1.COLOR_INTENSITIES:
            for cov in k1.COVERAGES:
                a = alpha_fn(cov, ci)
                rs.append(
                    {
                        "id": f"{color}{ci}{cov}",
                        "color": color,
                        "colorIntensity": ci,
                        "coverageIntensity": cov,
                        "linear_rgb": ((1 - a) * np.asarray(skin) + a * p).tolist(),
                        "hf_energy": 0.01,
                    }
                )
    return rs


def test_blend_fit_recovers_known_alpha():
    skin = np.array([0.58, 0.30, 0.19])
    rs = _synth_renders(skin, true_alpha)
    fit = k1.fit_blend(rs, skin)
    assert fit["r2"] > 0.99
    curves = k1.curve_lookup(fit)
    for ci in k1.COLOR_INTENSITIES:
        for cov in k1.COVERAGES:
            assert curves[ci][cov] == pytest.approx(true_alpha(cov, ci), abs=1e-6)


def test_blend_fit_enforces_monotone_curve():
    skin = np.array([0.5, 0.3, 0.2])
    alphas = {0: 0.0, 20: 0.3, 40: 0.2, 60: 0.5, 80: 0.6, 100: 0.7}  # dip at 40
    rs = _synth_renders(skin, lambda cov, ci: alphas[cov])
    curve = k1.curve_lookup(k1.fit_blend(rs, skin))[50]
    vals = [curve[c] for c in k1.COVERAGES]
    assert all(b >= a - 1e-12 for a, b in itertools.pairwise(vals))
    assert curve[20] == pytest.approx(0.25) and curve[40] == pytest.approx(0.25)


def _lab_render(color, ci, cov, status, l_val):
    return {
        "color": color,
        "colorIntensity": ci,
        "coverageIntensity": cov,
        "status": status,
        "lab_mean": [l_val, 10.0, 15.0],
    }


def _series_renders(l_by_cov, bad=None):
    rs = []
    for color in k1.COLORS:
        for ci in k1.COLOR_INTENSITIES:
            for cov, l_val in zip(k1.COVERAGES, l_by_cov):
                if bad and (color, ci) == bad[0]:
                    l_val = bad[1][cov]
                rs.append(_lab_render(color, ci, cov, "ok", l_val))
    return rs


def test_monotonic_check_flags_reversal():
    good = [60, 65, 70, 75, 80, 85]
    assert k1.check_monotonic(_series_renders(good))["pass"] is True
    # within 0.5 tolerance still passes
    wiggle = dict(zip(k1.COVERAGES, [60, 65, 70, 69.6, 80, 85]))
    assert k1.check_monotonic(_series_renders(good, (("#D2D2D2", 50), wiggle)))["pass"] is True
    reversal = dict(zip(k1.COVERAGES, [60, 65, 70, 68, 80, 85]))
    res = k1.check_monotonic(_series_renders(good, (("#D2D2D2", 50), reversal)))
    assert res["pass"] is False
    bad = [s for s in res["series"] if not s["pass"]]
    assert len(bad) == 1 and bad[0]["color"] == "#D2D2D2" and bad[0]["violation"]["coverage"] == 60


def test_no_face_render_counted_not_dropped(selfies, tmp_path):
    client = FakeClient(hide=lambda p: p["coverageIntensity"] == 100 and p["color"] == "#FFFFFF")
    code, out = _run(client, selfies, tmp_path)
    assert code == 0
    r = json.loads(out.read_text())
    assert len(r["renders"]) == 36
    assert r["n_no_face_a"] == 2 and r["n_usable_a"] == 34
    nf = [x for x in r["renders"] if x["status"] == "no_face"]
    assert {(x["color"], x["colorIntensity"], x["coverageIntensity"]) for x in nf} == {
        ("#FFFFFF", 50, 100),
        ("#FFFFFF", 100, 100),
    }
    assert all("linear_rgb" not in x for x in nf)
    assert r["fit"]["n_fitted"] == 34
    series = [s for s in r["monotonic"]["series"] if s["color"] == "#FFFFFF"]
    assert all(s["n_no_face"] == 1 for s in series)


def test_full_run_passes_with_ideal_fake(selfies, tmp_path):
    client = FakeClient()
    code, out = _run(client, selfies, tmp_path)
    assert code == 0
    r = json.loads(out.read_text())
    assert client.calls[0] == "require_budget:200"
    assert len(client.payloads) == 42
    assert all(p.name.endswith(".upload.jpg") for p in client.uploaded)
    assert selfies[0] not in client.uploaded and selfies[1] not in client.uploaded
    first = client.payloads[0]
    assert first["version"] == "1.0"
    assert first["effects"][0] == {
        "category": "skin_smooth",
        "skinSmoothStrength": 0,
        "skinSmoothColorIntensity": 0,
    }
    assert first["effects"][1]["palettes"][0]["glowIntensity"] == 0
    assert r["fit"]["r2"] > 0.99
    assert r["criteria_pass"] == {
        "monotonic": True,
        "r2": True,
        "max_dl": True,
        "inverse": True,
        "texture": True,
    }
    assert r["k1_pass"] is True
    assert r["texture"]["fraction_ok"] >= 0.8 and r["texture"]["n_eligible"] > 0
    assert all("predicted" in x and "observed" in x for x in r["texture"]["rows"])
    assert "result_url" not in json.dumps(r)
    assert all(x["icc_profile"] is False for x in r["renders"])
    assert "raw_alpha_by_color" in r["fit"]
    assert r["inverse_gating_de00"] <= 2.0
    assert r["balance_before"] == 1000 and r["balance_after"] == 958
    assert r["units_spent"] == 42
    assert len(r["inverse_renders"]) == 6
    assert (tmp_path / "contact.jpg").exists()
    assert len(r["pipeline_offset"]["de00_vs_input"]) == 6


def test_json_persisted_after_each_render(selfies, tmp_path):
    out = tmp_path / "k1.json"
    seen = []

    def check(n):
        if n >= 1:
            disk = json.loads(out.read_text())
            seen.append(len(disk["renders"]) + len(disk["inverse_renders"]))

    client = FakeClient(check_json=check)
    code, _ = _run(client, selfies, tmp_path)
    assert code == 0
    # before render n+1 the file already holds all n previous renders (none lost)
    assert seen == list(range(1, 42))


def test_error_mid_sweep_keeps_partial_and_stops(selfies, tmp_path):
    client = FakeClient(fail_on_run=5)
    client.balances = [1000, 996]
    code, out = _run(client, selfies, tmp_path)
    assert code != 0
    assert len(client.payloads) == 4  # no retry, no further calls
    r = json.loads(out.read_text())
    assert len(r["renders"]) == 4
    assert r["error"] == {
        "code": "error_boom",
        "task_id": "tX",
        "message": "task failed: error_boom",
    }
    assert r["balance_after"] == 996 and r["units_spent"] == 4
    assert r["k1_pass"] is False


def test_bad_download_magic_stops(selfies, tmp_path):
    client = FakeClient()
    client.download = lambda url, dest: dest.write_bytes(b"<html>nope</html>") or dest
    code, out = _run(client, selfies, tmp_path)
    assert code != 0
    r = json.loads(out.read_text())
    assert r["error"]["code"] == "bad_download" and r["error"]["task_id"] == "t1"
    assert len(client.payloads) == 1
    assert r["renders"][0]["task_id"] == "t1"  # the paid task id survived


def test_inverse_mapping_integers_and_curve_choice():
    curves = {
        50: {0: 0.0, 20: 0.05, 40: 0.10, 60: 0.15, 80: 0.18, 100: 0.20},
        100: {0: 0.0, 20: 0.15, 40: 0.30, 60: 0.45, 80: 0.55, 100: 0.60},
    }
    pl = k1.plan_inverse(curves, 0.35)
    assert pl["colorIntensity"] == 100 and pl["reachable"] is True
    assert isinstance(pl["coverageIntensity"], int) and 0 <= pl["coverageIntensity"] <= 100
    assert pl["coverageIntensity"] == 47  # 40 + 20 * (0.05 / 0.15)
    assert abs(pl["predicted_alpha"] - 0.35) < 0.01
    low = k1.plan_inverse(curves, 0.10)
    assert low["reachable"] and 0 <= low["coverageIntensity"] <= 100
    unreachable = k1.plan_inverse(curves, 0.9)
    assert unreachable["reachable"] is False and unreachable["coverageIntensity"] == 100
    assert unreachable["colorIntensity"] == 100


def test_texture_uses_ideal_linear_film_prediction():
    rng = np.random.default_rng(1)
    img = np.clip(np.array(SKIN) + rng.normal(0, 8, (600, 600, 3)), 0, 255).astype(np.uint8)
    mask = np.zeros((600, 600), dtype=bool)
    mask[200:300, 100:200] = True
    hf_in = k1.patch_stats(img, mask, 300.0)["hf_energy"]
    ctx = {"img": img, "mask": mask, "scale_px": 300.0, "hf_energy": hf_in}
    curves = {50: {0: 0.0, 20: 0.1, 40: 0.5}}
    a = 0.5
    ideal = (1 - a) * _decode(img / 255.0) + a * k1._hex_linear("#FFFFFF")
    ideal_u8 = np.rint(_encode(ideal) * 255.0).astype(np.uint8)
    hf_ideal = k1.patch_stats(ideal_u8, mask, 300.0)["hf_energy"]
    assert hf_ideal / hf_in != pytest.approx(1 - a, rel=0.2)  # gamma vs linear really differ

    def r(i, cov, hf, color="#FFFFFF"):
        return {
            "id": i,
            "color": color,
            "colorIntensity": 50,
            "coverageIntensity": cov,
            "hf_energy": hf,
        }

    zero = [r("zero", 0, hf_in), r("low", 20, hf_in)]  # a < 0.2 are skipped
    t = k1.check_texture(zero, curves, ctx)
    assert t["n_eligible"] == 0 and t["pass"] is False
    good = [r(f"g{i}", 40, hf_ideal * 1.05) for i in range(4)] + [r("bad", 40, hf_in)]
    t = k1.check_texture(good, curves, ctx)
    assert t["n_eligible"] == 5 and t["fraction_ok"] == pytest.approx(0.8) and t["pass"] is True
    assert t["rows"][0]["predicted"] == pytest.approx(hf_ideal / hf_in)
    assert t["rows"][0]["observed"] == pytest.approx(hf_ideal * 1.05 / hf_in)
    t = k1.check_texture(good[1:] + [r("bad2", 40, hf_in)], curves, ctx)
    assert t["fraction_ok"] == pytest.approx(0.6) and t["pass"] is False


def test_r2_pinned_to_hand_computed_value():
    skin = [0.5, 0.5, 0.5]

    def rr(cov, lin):
        return {
            "color": "#FFFFFF",
            "colorIntensity": 50,
            "coverageIntensity": cov,
            "linear_rgb": lin,
        }

    fit = k1.fit_blend([rr(0, [0.6, 0.6, 0.6]), rr(20, [0.8, 0.7, 0.9])], skin)
    # a = 0.2 and 0.6; SSres = 0.02, SStot = 0.02 + 0.005 + 0.045 = 0.07
    assert fit["r2"] == pytest.approx(1 - 0.02 / 0.07)
    assert fit["raw_alpha_by_color"]["50"]["20"]["#FFFFFF"] == pytest.approx(0.6)


def test_pav_with_unequal_weights():
    assert k1.isotonic_nondecreasing([3, 1], [1, 3]) == pytest.approx([1.5, 1.5])
    assert k1.isotonic_nondecreasing([1, 3, 2], [1, 1, 3]) == pytest.approx([1, 2.25, 2.25])
    assert k1.isotonic_nondecreasing([1, 2, 3], [5, 1, 2]) == pytest.approx([1, 2, 3])


def test_unreachable_gating_alpha_fails_inverse_only(selfies, tmp_path, monkeypatch):
    monkeypatch.setattr(sys.modules[__name__], "true_alpha", lambda cov, ci: 0.3 * cov / 100)
    code, out = _run(FakeClient(), selfies, tmp_path)
    assert code == 0
    r = json.loads(out.read_text())
    assert r["criteria_pass"]["inverse"] is False
    assert r["criteria_reasons"]["inverse"] == "target alpha not reachable"
    assert r["k1_pass"] is False


def test_one_failed_criterion_fails_k1(selfies, tmp_path, monkeypatch):
    monkeypatch.setitem(k1.THRESHOLDS, "max_dl_min", 99.0)
    code, out = _run(FakeClient(), selfies, tmp_path)
    assert code == 0
    r = json.loads(out.read_text())
    assert r["criteria_pass"] == {
        "monotonic": True,
        "r2": True,
        "max_dl": False,
        "inverse": True,
        "texture": True,
    }
    assert r["k1_pass"] is False


def test_monotonic_series_needs_four_points_and_coverage_100():
    good = [60, 65, 70, 75, 80, 85]
    rs = _series_renders(good)
    victim = [x for x in rs if x["color"] == "#BDBDBD" and x["colorIntensity"] == 100]
    for x in victim:
        if x["coverageIntensity"] in (20, 40, 60):  # 3 left, still includes cov 100
            x["status"] = "no_face"
    res = k1.check_monotonic(rs)
    s_ = next(x for x in res["series"] if x["color"] == "#BDBDBD" and x["colorIntensity"] == 100)
    assert s_["n_usable"] == 3 and not s_["evaluable"] and "unevaluable" in s_["reason"]
    assert res["pass"] is False
    rs = _series_renders(good)
    for x in rs:
        if x["color"] == "#BDBDBD" and x["colorIntensity"] == 100 and x["coverageIntensity"] == 100:
            x["status"] = "no_face"  # 5 usable but coverage 100 lost
    assert k1.check_monotonic(rs)["pass"] is False


def test_unexpected_exception_after_spend_is_recorded(selfies, tmp_path):
    client = FakeClient()

    def boom(url, dest):
        raise OSError("disk full")

    client.download = boom
    code, out = _run(client, selfies, tmp_path)
    assert code != 0
    r = json.loads(out.read_text())
    assert r["error"]["code"] == "unexpected" and "disk full" in r["error"]["message"]
    assert r["balance_after"] == 958 and r["k1_pass"] is False
    assert r["renders"][0]["task_id"] == "t1"


def _big(tmp_path, name, size):
    d = tmp_path / "big"
    d.mkdir(exist_ok=True)
    rng = np.random.default_rng(2)
    arr = np.clip(np.array(SKIN) + rng.normal(0, 6, (size[1], size[0], 3)), 0, 255)
    p = d / f"{name}.jpg"
    Image.fromarray(arr.astype(np.uint8)).save(p, "JPEG", quality=90)
    return p


@pytest.mark.parametrize("size", [(1698, 2625), (2400, 1300), (1919, 1079), (800, 600)])
def test_upload_copy_fits_makeup_vto_limits(tmp_path, size):
    from castforecast.preflight import upload_copy

    src = _big(tmp_path, "s", size)
    out = upload_copy(src, tmp_path / "o", max_width=1920, max_height=1080)
    with Image.open(out) as im:
        w, h = im.size
        assert w < 1920 and h < 1080
        assert min(abs(h - w * size[1] / size[0]), abs(w - h * size[0] / size[1])) <= 1.0  # 1 px
        assert not im.info.get("icc_profile") and not im.getexif()
        assert im.format == "JPEG"
    if size[0] < 1920 and size[1] < 1080:
        with Image.open(out) as im:
            assert im.size == size  # never enlarged or shrunk when it already fits


def test_run_uploads_resized_copy_and_uses_it_as_baseline(tmp_path):
    a = _big(tmp_path, "A", (1698, 2625))
    b = _big(tmp_path, "B", (2400, 1300))
    client = FakeClient()
    code, out = _run(client, (a, b), tmp_path)
    assert code == 0
    r = json.loads(out.read_text())
    for sz in r["upload_copy_size"].values():
        assert sz[0] < 1920 and sz[1] < 1080
    for p in client.uploaded:
        with Image.open(p) as im:
            assert im.width < 1920 and im.height < 1080
    with Image.open(client.uploaded[0]) as im:
        assert list(im.size) == r["upload_copy_size"]["A"]


def test_small_face_fails_before_any_spend(selfies, tmp_path, monkeypatch):
    monkeypatch.setattr(k1, "cheek_patches", lambda img: {**_fake_patches(img), "scale_px": 40.0})
    client = FakeClient()
    code, out = _run(client, selfies, tmp_path)
    assert code != 0
    r = json.loads(out.read_text())
    assert r["error"]["code"] == "face_too_small"
    assert client.calls == [] and client.payloads == []

"""K1b render retest, pre-registered in docs/gates/k1b-preregistration.md (do not change here).

19 paid Makeup VTO calls: 12 dose sweep on A (#FFFFFF, colorIntensity x coverage {0, 100}),
4 colour generality on A, 3 inverse renders on B toward #FFFFFF at coverage 100.
Model, linear RGB on the pooled cheek: render = (1 - g(ci)) * skin + g(ci) * palette, with g one
monotone non-decreasing curve in colorIntensity shared across coverage and palettes.
All five criteria must hold for k1b_pass.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from castforecast.color import de2000
from castforecast.k1_render import (
    FACE_WIDTH_PER_SCALE,
    MAX_H,
    MAX_W,
    MIN_BALANCE,
    MIN_FACE_WIDTH_PX,
    _hex_linear,
    _lab_of_linear,
    _record_balance_after,
    _render,
    check_texture,
    coverage_for_alpha,
    isotonic_nondecreasing,
    measure,
)
from castforecast.k2_tone import _write
from castforecast.preflight import preflight, upload_copy
from castforecast.youcam import YouCamClient, YouCamError

CIS = (0, 20, 40, 60, 80, 100)
SWEEP_COVERAGES = (0, 100)
GENERALITY = (("#D2D2D2", 40), ("#D2D2D2", 100), ("#BDBDBD", 40), ("#BDBDBD", 100))
FILM_COLOR = "#FFFFFF"
INVERSE_ALPHAS = (0.10, 0.169, 0.25)
GATING_ALPHA = 0.169
THRESHOLDS = {
    "mono_tol_l": 0.5,
    "mono_min_points": 5,
    "r2_min": 0.95,
    "capability_min": 0.219,
    "inverse_de_max": 2.0,
    "texture_min_g": 0.10,
    "texture_rel_tol": 0.20,
    "texture_min_fraction": 0.80,
}


def inverse_gate_ok(de: float, limit: float) -> bool:
    """Pass only when de <= limit holds; a NaN distance compares False and so fails."""
    return bool(de <= limit)


def classify_stop(code: str | None) -> str:
    """infrastructure (network, timeout, HTTP 5xx or 429) may be re-run once; all else is content."""
    c = code or ""
    if c in ("network", "timeout", "http_429") or (c.startswith("http_5") and len(c) == 8):
        return "infrastructure"
    return "content"


def fit_g(usable: list[dict], skin) -> dict:
    """Least squares g per colorIntensity level (all coverages and palettes), then PAV over ci."""
    skin = np.asarray(skin, dtype=np.float64)
    num: dict[int, float] = {}
    den: dict[int, float] = {}
    for r in usable:
        d = _hex_linear(r["color"]) - skin
        ci = r["colorIntensity"]
        num[ci] = num.get(ci, 0.0) + float(d @ (np.asarray(r["linear_rgb"]) - skin))
        den[ci] = den.get(ci, 0.0) + float(d @ d)
    levels = sorted(ci for ci in den if den[ci] > 0)
    raw = {ci: num[ci] / den[ci] for ci in levels}
    iso = isotonic_nondecreasing([raw[c] for c in levels], [den[c] for c in levels])
    g = {c: float(min(1.0, max(0.0, v))) for c, v in zip(levels, iso)}
    obs, pred = [], []
    for r in usable:
        gv = g.get(r["colorIntensity"])
        if gv is None:
            continue
        obs.append(np.asarray(r["linear_rgb"]))
        pred.append((1 - gv) * skin + gv * _hex_linear(r["color"]))
    r2 = None
    if obs:
        o, p = np.array(obs), np.array(pred)
        ss_tot = float(((o - o.mean(axis=0)) ** 2).sum())
        r2 = None if ss_tot <= 0 else 1.0 - float(((o - p) ** 2).sum()) / ss_tot
    return {
        "g": {str(c): v for c, v in g.items()},
        "raw_g": {str(c): v for c, v in raw.items()},
        "r2": r2,
        "n_fitted": len(obs),
    }


def check_monotonic(renders: list[dict]) -> dict:
    tol = THRESHOLDS["mono_tol_l"]
    series = []
    for cov in SWEEP_COVERAGES:
        rs = [
            r
            for r in renders
            if r["color"] == FILM_COLOR
            and r["coverageIntensity"] == cov
            and r["colorIntensity"] in CIS
        ]
        ok = sorted((r for r in rs if r["status"] == "ok"), key=lambda r: r["colorIntensity"])
        entry = {
            "coverage": cov,
            "n_usable": len(ok),
            "n_no_face": sum(1 for r in rs if r["status"] == "no_face"),
            "l_star": [r["lab_mean"][0] for r in ok],
            "evaluable": len(ok) >= THRESHOLDS["mono_min_points"]
            and any(r["colorIntensity"] == 100 for r in ok),
            "violation": None,
        }
        if not entry["evaluable"]:
            entry["reason"] = (
                f"unevaluable: needs >= {THRESHOLDS['mono_min_points']} usable points "
                f"including colorIntensity 100, have {len(ok)}"
            )
        run_max = -np.inf
        for r in ok:
            lv = r["lab_mean"][0]
            if lv < run_max - tol:
                entry["violation"] = {"colorIntensity": r["colorIntensity"], "l_star": lv}
                break
            run_max = max(run_max, lv)
        entry["pass"] = bool(entry["evaluable"] and entry["violation"] is None)
        series.append(entry)
    return {"pass": all(s["pass"] for s in series), "series": series}


def _contact(path, renders_dir, a_renders, b_renders, input_a):
    w, lh = 150, 24

    def tile(file, label):
        t = Image.new("RGB", (w, w + lh), (30, 30, 30))
        if file is not None and file.exists():
            with Image.open(file) as im:
                im = im.convert("RGB")
                im.thumbnail((w, w))
                t.paste(im, (0, lh))
        ImageDraw.Draw(t).text((3, 3), label, fill=(255, 255, 255))
        return t

    tiles = [tile(input_a, "input A")]
    for r in a_renders + b_renders:
        f = renders_dir / r["file"] if r.get("file") else None
        tag = f"{r['color'][1:]} ci{r['colorIntensity']} cov{r['coverageIntensity']}"
        tiles.append(tile(f, tag + (" no_face" if r["status"] == "no_face" else "")))
    cols = 7
    rows = -(-len(tiles) // cols)
    sheet = Image.new("RGB", (cols * w, rows * (w + lh)), (0, 0, 0))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * w, (i // cols) * (w + lh)))
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, "JPEG", quality=88)


def run_k1b(client, selfie_a, selfie_b, out, copies_dir, renders_dir, contact) -> int:
    selfie_a, selfie_b = Path(selfie_a), Path(selfie_b)
    copies_dir, renders_dir = Path(copies_dir), Path(renders_dir)
    out = Path(out)
    if out.exists():
        print(f"K1b refused: results file already exists at {out}", file=sys.stderr)
        return 1
    if renders_dir.is_dir() and (
        any(renders_dir.glob("A_*_ci*_cov*")) or any(renders_dir.glob("B_FFFFFF_a*"))
    ):
        print(f"K1b refused: {renders_dir} already contains K1b renders", file=sys.stderr)
        return 1
    renders_dir.mkdir(parents=True, exist_ok=True)
    result: dict = {
        "selfie_a": selfie_a.name,
        "selfie_b": selfie_b.name,
        "thresholds": THRESHOLDS,
        "renders": [],
        "inverse_renders": [],
        "k1b_pass": False,
    }
    a_renders: list[dict] = result["renders"]
    b_renders: list[dict] = result["inverse_renders"]
    state = {"balance_before": None, "input_a": None}

    def save() -> None:
        _write(out, result)

    def sheet() -> None:
        try:
            _contact(contact, renders_dir, a_renders, b_renders, state["input_a"] or selfie_a)
        except (OSError, ValueError) as exc:
            result["contact_sheet_error"] = str(exc)
            save()

    def fail(code: str, message: str, task_id: str | None = None) -> int:
        result["error"] = {"code": code, "task_id": task_id, "message": message}
        result["k1b_pass"] = False
        result["stop_class"] = classify_stop(code)
        if state["balance_before"] is not None:
            _record_balance_after(client, result, state["balance_before"])
        save()
        sheet()
        print(f"K1b stopped: {code}: {message}", file=sys.stderr)
        return 1

    for p in (selfie_a, selfie_b):
        pf = preflight(p)
        result.setdefault("preflight", {})[p.stem] = pf
        if not pf["ok"]:
            return fail("preflight", f"{p.name}: " + "; ".join(pf["reasons"]))

    try:
        copy_a = upload_copy(selfie_a, copies_dir, max_width=MAX_W, max_height=MAX_H)
        copy_b = upload_copy(selfie_b, copies_dir, max_width=MAX_W, max_height=MAX_H)
        with Image.open(copy_a) as ia, Image.open(copy_b) as ib:
            result["upload_copy_size"] = {"A": list(ia.size), "B": list(ib.size)}
        in_a, in_b = measure(copy_a, with_context=True), measure(copy_b)
    except (ValueError, OSError) as exc:
        return fail("local_prep", str(exc))
    if in_a is None or in_b is None:
        return fail("local_prep", "no usable cheek patch on an input upload copy")
    for name, m in (("A", in_a), ("B", in_b)):
        fw = m["scale_px"] * FACE_WIDTH_PER_SCALE
        result.setdefault("face_width_est_px", {})[name] = fw
        if fw < MIN_FACE_WIDTH_PX:
            return fail("face_too_small", f"{name}: estimated face width {fw:.0f}px < 100px")
    state["input_a"] = copy_a
    ctx = {
        "img": in_a.pop("_img"),
        "mask": in_a.pop("_mask"),
        "scale_px": in_a["scale_px"],
        "hf_energy": in_a["hf_energy"],
    }
    result["inputs"] = {"A": in_a, "B": in_b}
    skin_a = np.asarray(in_a["linear_rgb"])
    skin_b = np.asarray(in_b["linear_rgb"])

    plan_a = [(FILM_COLOR, ci, cov) for cov in SWEEP_COVERAGES for ci in CIS]
    plan_a += [(c, ci, 100) for c, ci in GENERALITY]
    try:
        state["balance_before"] = result["balance_before"] = client.require_budget(MIN_BALANCE)
        id_a = client.upload(copy_a)
        id_b = client.upload(copy_b)
        result["file_ids"] = {"A": id_a, "B": id_b}
        save()
        for color, ci, cov in plan_a:
            rec = {
                "id": f"A_{color.lstrip('#')}_ci{ci}_cov{cov}",
                "selfie": "A",
                "color": color,
                "colorIntensity": ci,
                "coverageIntensity": cov,
                "glowIntensity": 0,
            }
            _render(client, renders_dir, rec, id_a, a_renders, save)
            save()
    except YouCamError as exc:
        return fail(exc.code or "error", str(exc), exc.task_id)
    except Exception as exc:  # noqa: BLE001 - after any spend nothing may escape unrecorded
        return fail("unexpected", f"{type(exc).__name__}: {exc}")

    usable = [r for r in a_renders if r["status"] == "ok"]
    fit = fit_g(usable, skin_a)
    g = {int(c): v for c, v in fit["g"].items()}
    for r in a_renders:
        r["g"] = g.get(r["colorIntensity"])
    result.update(fit=fit, n_usable_a=len(usable))
    result["n_no_face_a"] = len(a_renders) - len(usable)
    save()

    plans = []
    if g:
        for t in INVERSE_ALPHAS:
            ci, g_at, reachable = coverage_for_alpha(g, t)
            plans.append(
                {
                    "target_alpha": t,
                    "colorIntensity": ci,
                    "coverageIntensity": 100,
                    "predicted_alpha": g_at,
                    "reachable": bool(reachable and 100 in g),
                    "ci100_lost": 100 not in g,
                }
            )
    result["inverse_plan"] = plans
    save()

    try:
        for pl in plans:
            rec = {
                "id": f"B_FFFFFF_a{round(pl['target_alpha'] * 1000):03d}",
                "selfie": "B",
                "color": FILM_COLOR,
                "colorIntensity": pl["colorIntensity"],
                "coverageIntensity": 100,
                "glowIntensity": 0,
                "target_alpha": pl["target_alpha"],
                "predicted_alpha": pl["predicted_alpha"],
                "reachable": pl["reachable"],
                "ci100_lost": pl["ci100_lost"],
            }
            _render(client, renders_dir, rec, id_b, b_renders, save)
            if rec["status"] == "ok":
                t = rec["target_alpha"]
                tgt = (1 - t) * skin_b + t * _hex_linear(FILM_COLOR)
                rec["target_lab"] = _lab_of_linear(tgt).tolist()
                rec["de00_to_target"] = de2000(rec["lab_of_mean"], rec["target_lab"])
            save()
    except YouCamError as exc:
        return fail(exc.code or "error", str(exc), exc.task_id)
    except Exception as exc:  # noqa: BLE001
        return fail("unexpected", f"{type(exc).__name__}: {exc}")

    mono = check_monotonic(a_renders)
    tex_curves = {ci: {100: v} for ci, v in g.items()}
    tex = check_texture(
        usable,
        tex_curves,
        ctx,
        min_a=THRESHOLDS["texture_min_g"],
        rel_tol=THRESHOLDS["texture_rel_tol"],
        min_fraction=THRESHOLDS["texture_min_fraction"],
    )
    for row in tex["rows"]:
        rec = next(r for r in a_renders if r["id"] == row["id"])
        rec["texture_predicted"], rec["texture_observed"] = row["predicted"], row["observed"]
    gating = next((r for r in b_renders if abs(r["target_alpha"] - GATING_ALPHA) < 1e-9), None)
    reasons: dict[str, str] = {}
    inverse_ok = False
    if gating is None:
        reasons["inverse"] = "no gating render was made"
    elif gating["status"] != "ok":
        reasons["inverse"] = f"gating render status {gating['status']}"
    elif gating.get("ci100_lost"):
        reasons["inverse"] = "colorIntensity-100 cell needed for inversion was lost to no_face"
    elif not gating["reachable"]:
        reasons["inverse"] = "target alpha not reachable"
    elif not inverse_gate_ok(gating["de00_to_target"], THRESHOLDS["inverse_de_max"]):
        reasons["inverse"] = f"dE00 {gating['de00_to_target']} above limit"
    else:
        inverse_ok = True
    all_usable = len(usable) == len(plan_a) and fit["n_fitted"] == len(plan_a)
    if not all_usable:
        reasons["r2"] = (
            f"criterion 2 needs all {len(plan_a)} A renders usable, have {len(usable)} "
            f"({fit['n_fitted']} fitted)"
        )
    crit = {
        "monotonic": bool(mono["pass"]),
        "r2": bool(all_usable and fit["r2"] is not None and fit["r2"] >= THRESHOLDS["r2_min"]),
        "capability": bool(100 in g and g[100] >= THRESHOLDS["capability_min"]),
        "inverse": inverse_ok,
        "texture": bool(tex["pass"]),
    }
    result.update(
        monotonic=mono,
        texture=tex,
        criteria_pass=crit,
        criteria_reasons=reasons,
        inverse_gating_de00=gating.get("de00_to_target") if gating else None,
        g100=g.get(100),
    )
    result["k1b_pass"] = bool(all(crit.values()))
    _record_balance_after(client, result, state["balance_before"])
    save()
    sheet()
    print(
        f"K1b {'PASS' if result['k1b_pass'] else 'FAIL'}: r2={fit['r2']} g100={g.get(100)} "
        f"inverse_de={result['inverse_gating_de00']} criteria={crit} "
        f"units={result.get('units_spent')}"
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="K1b render retest (spends 19 units)")
    ap.add_argument("--selfie", required=True)
    ap.add_argument("--check", required=True)
    ap.add_argument("--out", default="recon/gate/k1b.json")
    ap.add_argument("--root", default=".")
    args = ap.parse_args(argv)
    root = Path(args.root)
    sd = root / "private_inputs" / "selfies"
    return run_k1b(
        YouCamClient(),
        sd / f"{args.selfie}.jpg",
        sd / f"{args.check}.jpg",
        root / args.out,
        root / "private_inputs" / "upload_copies",
        root / "private_inputs" / "k1b_renders",
        root / "private_inputs" / "k1b_contact.jpg",
    )


if __name__ == "__main__":
    sys.exit(main())

"""Historical: K1 FAIL, kept as the code of record; K1b reuses its measurement helpers.

K1 render-sweep experiment: does YouCam's foundation effect behave like a sunscreen film, with
coverage as the dose? Result and measured values: docs/gates/k1-results.md.

Pass rule as it ran (all five must hold). Criteria 1, 4 and 5 were amended before any K1 data
existed, at 808cdea; the original wording is in this docstring at 14a283a.
  1 monotonic   per color and colorIntensity, cheek L* is non-decreasing with coverage, tolerance
                0.5 L* against the running maximum; a series needs >= 4 usable points including
                coverage 100, otherwise it is unevaluable and fails
  2 r2          blend model R^2 >= 0.95 over all usable A renders (3 linear-RGB channels each)
  3 max_dl      best A render cheek dL* vs the input >= +15
  4 inverse     B rendered at the (coverage, colorIntensity) the fit picks for alpha 0.35 toward
                #D2D2D2 lands within dE00 2.0 of the target (Lab of the pooled linear-RGB mean);
                an unreachable target fails
  5 texture     for usable A renders with fitted a >= 0.2, the observed ratio hf_render / hf_input
                is within 20 percent of the ratio for an ideal film synthesized on the input in
                linear light at the same a and palette color (encoded to sRGB and measured with the
                input's own mask), for at least 80 percent of them

The inverse gate in this module fails on dE00 > 2.0, so a NaN distance would pass it; K1b uses
<= instead. The K1 run's gating distance was a finite 2.03.

Blend model, in linear RGB on the pooled cheek patch: out = (1 - a) * skin + a * palette, with skin
the cheek value of the input upload copy of A and a a non-decreasing function of coverage for each
colorIntensity, shared by the three colors. Never retries a paid call; stops on the first error.
Changed after the K1 run: for K1b, check_texture gained optional min_a (8fd3d1b), rel_tol and
min_fraction (4b2b415) parameters whose defaults are K1's own thresholds; the CLI now refuses to
overwrite an earlier results file or K1 renders. Nothing in K1's measurement or criteria changed.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps

from castforecast.color import _decode, _encode, de2000, srgb_to_lab
from castforecast.k2_tone import _write, refuse_existing
from castforecast.patch import cheek_patches, patch_stats
from castforecast.preflight import preflight, upload_copy
from castforecast.youcam import YouCamClient, YouCamError

ENDPOINT = "task/makeup-vto"  # client.run adds the /s2s/v2.0/ prefix
MIN_BALANCE = 200
MONO_MIN_POINTS = 4
MAX_W, MAX_H = 1920, 1080  # Makeup VTO needs width < 1920 and height < 1080
MIN_FACE_WIDTH_PX = 100
FACE_WIDTH_PER_SCALE = 1.55  # face width ~ 1.55 x outer-eye-corner distance (scale_px), an estimate
COLORS = ("#FFFFFF", "#D2D2D2", "#BDBDBD")
COVERAGES = (0, 20, 40, 60, 80, 100)
COLOR_INTENSITIES = (50, 100)
FILM_COLOR = "#D2D2D2"
GATING_ALPHA = 0.35
INVERSE_ALPHAS = (0.10, 0.20, 0.35, 0.50, 0.60, 0.70)
THRESHOLDS = {
    "mono_tol_l": 0.5,
    "r2_min": 0.95,
    "max_dl_min": 15.0,
    "inverse_de_max": 2.0,
    "texture_rel_tol": 0.20,
    "texture_min_a": 0.2,
    "texture_min_fraction": 0.80,
}


# ---------------------------------------------------------------- measurement


def _hex_linear(h: str) -> np.ndarray:
    h = h.strip().lstrip("#")
    if len(h) != 6:
        raise ValueError(f"expected #RRGGBB, got {h!r}")
    rgb = np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64) / 255.0
    return _decode(rgb)


def _lab_of_linear(lin) -> np.ndarray:
    return srgb_to_lab(np.clip(_encode(np.asarray(lin, dtype=np.float64)), 0.0, 1.0))


def load_rgb(path: Path) -> np.ndarray:
    """Load as RGB uint8 with the EXIF orientation applied."""
    with Image.open(path) as im:
        return np.asarray(ImageOps.exif_transpose(im).convert("RGB"))


def has_icc(path: Path) -> bool:
    with Image.open(path) as im:
        return im.info.get("icc_profile") is not None


def measure(path: Path, with_context: bool = False) -> dict | None:
    """Cheek stats of the image at path, re-detecting the cheeks on THIS image. None if no face."""
    img = load_rgb(path)
    patches = cheek_patches(img)
    if patches is None:
        return None
    mask = patches["left"] | patches["right"]
    stats = patch_stats(img, mask, patches["scale_px"])
    lin = _decode(img.astype(np.float64) / 255.0)[mask].mean(axis=0)
    return {
        "linear_rgb": lin.tolist(),
        "lab_mean": np.asarray(stats["lab_mean"]).tolist(),
        "lab_of_mean": _lab_of_linear(lin).tolist(),
        "hf_energy": float(stats["hf_energy"]),
        "scale_px": float(patches["scale_px"]),
        **({"_img": img, "_mask": mask} if with_context else {}),
    }


# ---------------------------------------------------------------- the fit


def isotonic_nondecreasing(y, w) -> list[float]:
    """Weighted pool-adjacent-violators: the non-decreasing sequence closest to y in weighted LS."""
    blocks: list[list[float]] = []  # [value, weight, count]
    for yi, wi in zip(y, w):
        blocks.append([float(yi), float(wi), 1])
        while len(blocks) > 1 and blocks[-2][0] > blocks[-1][0]:
            v2, w2, n2 = blocks.pop()
            v1, w1, n1 = blocks.pop()
            tw = w1 + w2
            blocks.append([(v1 * w1 + v2 * w2) / tw if tw > 0 else (v1 + v2) / 2, tw, n1 + n2])
    out: list[float] = []
    for v, _, n in blocks:
        out.extend([v] * n)
    return out


def fit_blend(usable: list[dict], skin) -> dict:
    """Fit a(coverage, colorIntensity) and report R^2 over all usable renders.

    usable items need color, colorIntensity, coverageIntensity and linear_rgb.
    """
    skin = np.asarray(skin, dtype=np.float64)
    cells: dict[tuple[int, int], list[dict]] = {}
    for r in usable:
        cells.setdefault((r["colorIntensity"], r["coverageIntensity"]), []).append(r)
    raw: dict[int, dict[int, tuple[float, float]]] = {}
    by_color: dict[str, dict[str, dict[str, float]]] = {}
    for (ci, cov), rs in cells.items():
        num = den = 0.0
        for r in rs:
            d = _hex_linear(r["color"]) - skin
            n_r, d_r = float(d @ (np.asarray(r["linear_rgb"]) - skin)), float(d @ d)
            num += n_r
            den += d_r
            if d_r > 0:
                by_color.setdefault(str(ci), {}).setdefault(str(cov), {})[r["color"]] = n_r / d_r
        if den > 0:
            raw.setdefault(ci, {})[cov] = (num / den, den)
    curves: dict[int, dict[int, float]] = {}
    for ci, byc in raw.items():
        covs = sorted(byc)
        iso = isotonic_nondecreasing([byc[c][0] for c in covs], [byc[c][1] for c in covs])
        curves[ci] = {c: float(min(1.0, max(0.0, a))) for c, a in zip(covs, iso)}
    obs, pred = [], []
    for r in usable:
        a = curves.get(r["colorIntensity"], {}).get(r["coverageIntensity"])
        if a is None:
            continue
        obs.append(np.asarray(r["linear_rgb"]))
        pred.append((1 - a) * skin + a * _hex_linear(r["color"]))
    r2 = None
    if obs:
        o, p = np.array(obs), np.array(pred)
        ss_tot = float(((o - o.mean(axis=0)) ** 2).sum())
        ss_res = float(((o - p) ** 2).sum())
        r2 = None if ss_tot <= 0 else 1.0 - ss_res / ss_tot
    return {
        "curves": {str(ci): {str(c): a for c, a in cv.items()} for ci, cv in curves.items()},
        "raw_alpha": {str(ci): {str(c): v[0] for c, v in byc.items()} for ci, byc in raw.items()},
        "raw_alpha_by_color": by_color,
        "r2": r2,
        "n_fitted": len(obs),
    }


def curve_lookup(fit: dict) -> dict[int, dict[int, float]]:
    return {int(ci): {int(c): a for c, a in cv.items()} for ci, cv in fit["curves"].items()}


# ---------------------------------------------------------------- criteria


def check_monotonic(renders: list[dict], tol: float = THRESHOLDS["mono_tol_l"]) -> dict:
    series = []
    for color in COLORS:
        for ci in COLOR_INTENSITIES:
            rs = [r for r in renders if r["color"] == color and r["colorIntensity"] == ci]
            ok = sorted(
                (r for r in rs if r["status"] == "ok"), key=lambda r: r["coverageIntensity"]
            )
            n_no_face = sum(1 for r in rs if r["status"] == "no_face")
            entry = {
                "color": color,
                "colorIntensity": ci,
                "n_usable": len(ok),
                "n_no_face": n_no_face,
                "l_star": [r["lab_mean"][0] for r in ok],
                "evaluable": len(ok) >= MONO_MIN_POINTS
                and any(r["coverageIntensity"] == 100 for r in ok),
                "violation": None,
            }
            if not entry["evaluable"]:
                entry["reason"] = (
                    f"unevaluable: needs >= {MONO_MIN_POINTS} usable points including "
                    f"coverage 100, have {len(ok)}"
                )
            run_max = -np.inf
            for r in ok:
                l_val = r["lab_mean"][0]
                if l_val < run_max - tol:
                    entry["violation"] = {
                        "coverage": r["coverageIntensity"],
                        "l_star": l_val,
                        "running_max": float(run_max),
                    }
                    break
                run_max = max(run_max, l_val)
            entry["pass"] = entry["evaluable"] and entry["violation"] is None
            series.append(entry)
    return {"pass": all(s["pass"] for s in series), "series": series}


def check_texture(
    usable: list[dict],
    curves: dict[int, dict[int, float]],
    ctx: dict,
    min_a: float | None = None,
    rel_tol: float | None = None,
    min_fraction: float | None = None,
) -> dict:
    """Texture check against the IDEAL linear-light film on the input image.

    ctx: img (input upload copy, uint8), mask, scale_px, hf_energy of the input. For each usable
    render with fitted a >= min_a (default THRESHOLDS texture_min_a), the ideal film (1 - a) * skin + a * palette is built per pixel in
    linear light, encoded to sRGB, and measured on the input's own mask and scale_px; the
    predicted ratio is hf_ideal / hf_input and the observed ratio is hf_render / hf_input.
    """
    rel_tol = THRESHOLDS["texture_rel_tol"] if rel_tol is None else rel_tol
    min_fraction = THRESHOLDS["texture_min_fraction"] if min_fraction is None else min_fraction
    hf_in = ctx["hf_energy"]
    lin_in = _decode(ctx["img"].astype(np.float64) / 255.0)
    rows = []
    for r in usable:
        a = curves.get(r["colorIntensity"], {}).get(r["coverageIntensity"])
        if a is None or a < (THRESHOLDS["texture_min_a"] if min_a is None else min_a):
            continue
        ideal = (1 - a) * lin_in + a * _hex_linear(r["color"])
        ideal_u8 = np.clip(np.rint(_encode(np.clip(ideal, 0.0, 1.0)) * 255.0), 0, 255).astype(
            np.uint8
        )
        hf_ideal = patch_stats(ideal_u8, ctx["mask"], ctx["scale_px"])["hf_energy"]
        pred = hf_ideal / hf_in if hf_in > 0 else None
        obs = r["hf_energy"] / hf_in if hf_in > 0 else None
        ok = pred is not None and obs is not None and abs(obs - pred) <= rel_tol * pred
        rows.append({"id": r["id"], "a": a, "predicted": pred, "observed": obs, "ok": bool(ok)})
    frac = (sum(x["ok"] for x in rows) / len(rows)) if rows else None
    return {
        "n_eligible": len(rows),
        "fraction_ok": frac,
        "rows": rows,
        "pass": frac is not None and frac >= min_fraction,
    }


def coverage_for_alpha(curve: dict[int, float], target: float) -> tuple[int, float, bool]:
    """Invert a non-decreasing coverage -> alpha curve (linear between measured points).

    Returns (integer coverage 0..100, curve alpha at that integer, reachable).
    """
    covs = sorted(curve)
    vals = [curve[c] for c in covs]
    if target > vals[-1]:
        return 100, float(np.interp(100, covs, vals)), False
    if target <= vals[0]:
        cov = covs[0]
    else:
        i = next(k for k, v in enumerate(vals) if v >= target)
        lo, hi = covs[i - 1], covs[i]
        a_lo, a_hi = vals[i - 1], vals[i]
        cov = lo + (hi - lo) * (target - a_lo) / (a_hi - a_lo) if a_hi > a_lo else lo
    cov_i = int(min(100, max(0, round(cov))))
    return cov_i, float(np.interp(cov_i, covs, vals)), True


def plan_inverse(curves: dict[int, dict[int, float]], target: float) -> dict | None:
    """Pick (coverage, colorIntensity) integers whose fitted alpha is nearest the target.

    Only colorIntensity curves that reach the target are eligible; if none does, the curve that
    gets closest is used and reachable is False. Ties go to the higher colorIntensity.
    """
    best = None
    for ci in sorted(curves, reverse=True):
        if not curves[ci]:
            continue
        cov, a_at, reachable = coverage_for_alpha(curves[ci], target)
        key = (not reachable, abs(a_at - target))
        if best is None or key < best[0]:
            best = (
                key,
                {
                    "coverageIntensity": cov,
                    "colorIntensity": int(ci),
                    "predicted_alpha": a_at,
                    "reachable": reachable,
                    "cov100_lost": 100 not in curves[ci],
                },
            )
    return None if best is None else best[1]


# ---------------------------------------------------------------- IO helpers


def _payload(file_id: str, color: str, ci: int, cov: int) -> dict:
    return {
        "src_file_id": file_id,
        "version": "1.0",
        "effects": [
            {"category": "skin_smooth", "skinSmoothStrength": 0, "skinSmoothColorIntensity": 0},
            {
                "category": "foundation",
                "palettes": [
                    {
                        "color": color,
                        "colorIntensity": int(ci),
                        "glowIntensity": 0,
                        "coverageIntensity": int(cov),
                    }
                ],
            },
        ],
    }


def _render(client, renders_dir: Path, rec: dict, file_id: str, sink: list, on_paid) -> None:
    """One paid render. rec is appended to sink as soon as the task id is known."""
    task_id = client.run(
        ENDPOINT, _payload(file_id, rec["color"], rec["colorIntensity"], rec["coverageIntensity"])
    )
    rec["task_id"] = task_id
    rec["status"] = "pending_download"
    sink.append(rec)
    on_paid()  # the paid task id is on disk before anything else can fail
    res = client.poll(ENDPOINT, task_id)
    url = res.get("url") if isinstance(res, dict) else None
    if not isinstance(url, str) or not url:
        raise YouCamError(f"task {task_id} result had no url", code="bad_shape", task_id=task_id)
    tmp = Path(renders_dir) / f"{rec['id']}.download"
    client.download(url, tmp)
    head = tmp.read_bytes()[:8]
    if head[:3] == b"\xff\xd8\xff":
        ext = "jpg"
    elif head[:4] == b"\x89PNG":
        ext = "png"
    else:
        raise YouCamError(
            f"task {task_id} download is not a JPEG or PNG", code="bad_download", task_id=task_id
        )
    dest = tmp.with_suffix("." + ext)
    tmp.replace(dest)
    rec["file"] = dest.name
    try:
        rec["icc_profile"] = has_icc(dest)
        m = measure(dest)
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise YouCamError(
            f"task {task_id} render unreadable: {exc}", code="bad_download", task_id=task_id
        ) from exc
    if m is None:
        rec["status"] = "no_face"
    else:
        rec["status"] = "ok"
        rec.update(m)


def _record_balance_after(client, result: dict, balance_before: int) -> None:
    try:
        result["balance_after"] = client.balance()
        result["units_spent"] = balance_before - result["balance_after"]
    except YouCamError as exc:
        result["balance_after_error"] = True
        result["balance_after_error_code"] = exc.code


def build_contact_sheet(
    path: Path, renders_dir: Path, a_renders: list, b_renders: list, input_a: Path
) -> None:
    thumb_w, label_h = 180, 28

    def tile(file: Path | None, label: str) -> Image.Image:
        t = Image.new("RGB", (thumb_w, thumb_w + label_h), (30, 30, 30))
        if file is not None and file.exists():
            with Image.open(file) as im:
                im = im.convert("RGB")
                im.thumbnail((thumb_w, thumb_w))
                t.paste(im, (0, label_h))
        ImageDraw.Draw(t).text((3, 3), label, fill=(255, 255, 255))
        return t

    rows: list[list[Image.Image]] = []
    by_key = {(r["color"], r["colorIntensity"], r["coverageIntensity"]): r for r in a_renders}
    for color in COLORS:
        for ci in COLOR_INTENSITIES:
            row = [
                tile(
                    input_a if color == COLORS[0] and ci == COLOR_INTENSITIES[0] else None,
                    "input A" if color == COLORS[0] and ci == COLOR_INTENSITIES[0] else "",
                )
            ]
            for cov in COVERAGES:
                r = by_key.get((color, ci, cov))
                f = renders_dir / r["file"] if r and r.get("file") else None
                tag = "" if not r else ("no_face" if r["status"] == "no_face" else "")
                row.append(tile(f, f"{color} cov{cov} ci{ci} {tag}".strip()))
            rows.append(row)
    if b_renders:
        row = []
        for r in b_renders:
            f = renders_dir / r["file"] if r.get("file") else None
            row.append(
                tile(f, f"B a{r['target_alpha']} c{r['coverageIntensity']} i{r['colorIntensity']}")
            )
        rows.append(row)
    cols = max(len(r) for r in rows)
    sheet = Image.new("RGB", (cols * thumb_w, len(rows) * (thumb_w + label_h)), (0, 0, 0))
    for y, row in enumerate(rows):
        for x, t in enumerate(row):
            sheet.paste(t, (x * thumb_w, y * (thumb_w + label_h)))
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, "JPEG", quality=88)


# ---------------------------------------------------------------- the experiment


def run_k1(
    client,
    selfie_a: Path,
    selfie_b: Path,
    out: Path,
    copies_dir: Path,
    renders_dir: Path,
    contact: Path,
) -> int:
    selfie_a, selfie_b = Path(selfie_a), Path(selfie_b)
    copies_dir, renders_dir = Path(copies_dir), Path(renders_dir)
    if refuse_existing(out, "K1"):
        return 1
    if renders_dir.is_dir() and (
        any(renders_dir.glob("A_*_cov*_ci*")) or any(renders_dir.glob("B_D2D2D2_a*"))
    ):
        print(f"K1 refused: {renders_dir} already contains K1 renders", file=sys.stderr)
        return 1
    renders_dir.mkdir(parents=True, exist_ok=True)
    result: dict = {
        "selfie_a": selfie_a.name,
        "selfie_b": selfie_b.name,
        "thresholds": THRESHOLDS,
        "renders": [],
        "inverse_renders": [],
        "k1_pass": False,
    }
    a_renders: list[dict] = result["renders"]
    b_renders: list[dict] = result["inverse_renders"]
    state = {"balance_before": None, "input_a": None}

    def save() -> None:
        _write(out, result)

    def finish_sheet() -> None:
        try:
            build_contact_sheet(
                contact, renders_dir, a_renders, b_renders, state["input_a"] or selfie_a
            )
        except (OSError, ValueError) as exc:
            result["contact_sheet_error"] = str(exc)
            save()

    def fail(code: str, message: str, task_id: str | None = None) -> int:
        result["error"] = {"code": code, "task_id": task_id, "message": message}
        result["k1_pass"] = False
        if state["balance_before"] is not None:
            _record_balance_after(client, result, state["balance_before"])
        save()
        finish_sheet()
        print(f"K1 stopped: {code}: {message}", file=sys.stderr)
        return 1

    for p in (selfie_a, selfie_b):
        pf = preflight(p)
        result.setdefault("preflight", {})[p.stem] = pf
        if not pf["ok"]:
            return fail("preflight", f"{p.name}: " + "; ".join(pf["reasons"]))

    # Offline preparation first: nothing is uploaded or billed until every local step has worked.
    try:
        copy_a = upload_copy(selfie_a, copies_dir, max_width=MAX_W, max_height=MAX_H)
        copy_b = upload_copy(selfie_b, copies_dir, max_width=MAX_W, max_height=MAX_H)
        with Image.open(copy_a) as im_a, Image.open(copy_b) as im_b:
            result["upload_copy_size"] = {"A": list(im_a.size), "B": list(im_b.size)}
        in_a, in_b = measure(copy_a, with_context=True), measure(copy_b)
    except (ValueError, OSError) as exc:
        return fail("local_prep", str(exc))
    if in_a is None or in_b is None:
        return fail("local_prep", "no usable cheek patch on an input upload copy")
    for name, m in (("A", in_a), ("B", in_b)):
        face_w = m["scale_px"] * FACE_WIDTH_PER_SCALE
        result.setdefault("face_width_est_px", {})[name] = face_w
        if face_w < MIN_FACE_WIDTH_PX:
            return fail(
                "face_too_small",
                f"{name}: estimated face width {face_w:.0f}px on the resized upload copy "
                f"is under {MIN_FACE_WIDTH_PX}px",
            )
    state["input_a"] = copy_a
    tex_ctx = {
        "img": in_a.pop("_img"),
        "mask": in_a.pop("_mask"),
        "scale_px": in_a["scale_px"],
        "hf_energy": in_a["hf_energy"],
    }
    result["inputs"] = {"A": in_a, "B": in_b}
    skin_a = np.asarray(in_a["linear_rgb"])
    skin_b = np.asarray(in_b["linear_rgb"])

    try:
        state["balance_before"] = result["balance_before"] = client.require_budget(MIN_BALANCE)
        id_a = client.upload(copy_a)
        id_b = client.upload(copy_b)
        result["file_ids"] = {"A": id_a, "B": id_b}
        save()
        for color in COLORS:
            for ci in COLOR_INTENSITIES:
                for cov in COVERAGES:
                    rec = {
                        "id": f"A_{color.lstrip('#')}_cov{cov}_ci{ci}",
                        "selfie": "A",
                        "color": color,
                        "colorIntensity": ci,
                        "coverageIntensity": cov,
                        "glowIntensity": 0,
                    }
                    _render(client, renders_dir, rec, id_a, a_renders, save)
                    save()  # nothing paid is lost
    except YouCamError as exc:
        return fail(exc.code or "error", str(exc), exc.task_id)
    except Exception as exc:  # noqa: BLE001 - after any spend nothing may escape unrecorded
        return fail("unexpected", f"{type(exc).__name__}: {exc}")

    usable = [r for r in a_renders if r["status"] == "ok"]
    fit = fit_blend(usable, skin_a)
    curves = curve_lookup(fit)
    result["n_no_face_a"] = sum(1 for r in a_renders if r["status"] == "no_face")
    result["n_usable_a"] = len(usable)
    result["fit"] = fit
    zero = [r for r in usable if r["coverageIntensity"] == 0]
    result["pipeline_offset"] = {
        "n": len(zero),
        "de00_vs_input": [de2000(r["lab_of_mean"], in_a["lab_of_mean"]) for r in zero],
        "linear_rgb_delta": [(np.asarray(r["linear_rgb"]) - skin_a).tolist() for r in zero],
        "note": "reported only; never subtracted from the fit",
    }
    save()

    # Inverse plan on B, from the fit. Nothing is spent if the fit cannot be inverted.
    plans = []
    for t in INVERSE_ALPHAS:
        pl = plan_inverse(curves, t)
        if pl is not None:
            plans.append({"target_alpha": t, **pl})
    result["inverse_plan"] = plans
    save()
    if len(plans) != len(INVERSE_ALPHAS):
        result["inverse_skipped"] = "fit produced no usable alpha curve"

    try:
        for pl in plans:
            rec = {
                "id": f"B_{FILM_COLOR.lstrip('#')}_a{round(pl['target_alpha'] * 100):02d}",
                "selfie": "B",
                "color": FILM_COLOR,
                "colorIntensity": pl["colorIntensity"],
                "coverageIntensity": pl["coverageIntensity"],
                "glowIntensity": 0,
                "target_alpha": pl["target_alpha"],
                "predicted_alpha": pl["predicted_alpha"],
                "reachable": pl["reachable"],
                "cov100_lost": pl["cov100_lost"],
            }
            _render(client, renders_dir, rec, id_b, b_renders, save)
            if rec["status"] == "ok":
                target_lin = (1 - rec["target_alpha"]) * skin_b + rec["target_alpha"] * _hex_linear(
                    FILM_COLOR
                )
                rec["target_lab"] = _lab_of_linear(target_lin).tolist()
                rec["de00_to_target"] = de2000(rec["lab_of_mean"], rec["target_lab"])
            save()
    except YouCamError as exc:
        return fail(exc.code or "error", str(exc), exc.task_id)
    except Exception as exc:  # noqa: BLE001 - after any spend nothing may escape unrecorded
        return fail("unexpected", f"{type(exc).__name__}: {exc}")

    # Score.
    in_l = in_a["lab_mean"][0]
    gating = next((r for r in b_renders if abs(r["target_alpha"] - GATING_ALPHA) < 1e-9), None)
    mono = check_monotonic(a_renders)
    tex = check_texture(usable, curves, tex_ctx)
    max_dl = max((r["lab_mean"][0] - in_l for r in usable), default=None)
    reasons: dict[str, str] = {}
    inverse_ok = False
    if gating is None:
        reasons["inverse"] = "no gating render was made"
    elif gating["status"] != "ok":
        reasons["inverse"] = f"gating render status {gating['status']}"
    elif gating.get("cov100_lost"):
        reasons["inverse"] = "coverage-100 cell needed for inversion was lost to no_face"
    elif not gating["reachable"]:
        reasons["inverse"] = "target alpha not reachable"
    elif gating["de00_to_target"] > THRESHOLDS["inverse_de_max"]:
        reasons["inverse"] = f"dE00 {gating['de00_to_target']:.2f} above limit"
    else:
        inverse_ok = True
    for s_ in mono["series"]:
        if not s_["pass"]:
            reasons.setdefault("monotonic", "")
            reasons["monotonic"] += (
                f"{s_['color']} ci{s_['colorIntensity']}: "
                f"{s_.get('reason') or 'L* reversal at coverage ' + str(s_['violation']['coverage'])}; "
            )
    crit = {
        "monotonic": mono["pass"],
        "r2": fit["r2"] is not None and fit["r2"] >= THRESHOLDS["r2_min"],
        "max_dl": max_dl is not None and max_dl >= THRESHOLDS["max_dl_min"],
        "inverse": inverse_ok,
        "texture": tex["pass"],
    }
    result["monotonic"] = mono
    result["texture"] = tex
    result["max_dl_star"] = max_dl
    result["inverse_gating_de00"] = gating.get("de00_to_target") if gating else None
    result["criteria_pass"] = crit
    result["criteria_reasons"] = reasons
    result["k1_pass"] = all(crit.values())
    _record_balance_after(client, result, state["balance_before"])
    save()
    finish_sheet()
    verdict = "PASS" if result["k1_pass"] else "FAIL"
    print(
        f"K1 {verdict}: r2={fit['r2']} max_dl={max_dl} inverse_de={result['inverse_gating_de00']} "
        f"criteria={crit} no_face={result['n_no_face_a']} units={result.get('units_spent')}"
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="K1 render sweep (spends 42 units)")
    ap.add_argument("--selfie", required=True, help="selfie name for the sweep, e.g. A")
    ap.add_argument("--check", required=True, help="selfie name for the inverse check, e.g. B")
    ap.add_argument("--out", default="recon/gate/k1.json")
    ap.add_argument("--root", default=".", help="project root")
    args = ap.parse_args(argv)
    root = Path(args.root)
    sd = root / "private_inputs" / "selfies"
    if refuse_existing(root / args.out, "K1"):  # before the client reads the key
        return 1
    return run_k1(
        YouCamClient(),
        sd / f"{args.selfie}.jpg",
        sd / f"{args.check}.jpg",
        root / args.out,
        root / "private_inputs" / "upload_copies",
        root / "private_inputs" / "k1_renders",
        root / "private_inputs" / "k1_contact.jpg",
    )


if __name__ == "__main__":
    sys.exit(main())

"""K2 tone-read experiment: does YouCam's skin-tone hex track the pixels we send?

Three tone calls (60 units): the upload copy of the selfie, the same copy again (repeat), and a
+10% linear-light gain copy. Pre-registered pass rule, all three must hold:
  repeat_de          <= 1.0   dE00 between the two calls on the same image
  gain_response_ratio >= 0.7  dE00(api orig, api gain) / dE00(own patch orig, own patch gain)
  api_vs_patch_de    <= 3.0   dE00 between the API hex and our pooled cheek-patch Lab mean

Own cheek value: pixel-weighted pooled Lab mean over the union of both cheek masks, measured on the
exact image that was uploaded, with the scale_px of that same detection.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from castforecast.color import apply_linear_gain, de2000, hex_to_lab
from castforecast.patch import cheek_patches, patch_stats
from castforecast.preflight import preflight, upload_copy
from castforecast.youcam import YouCamClient, YouCamError

ENDPOINT = "task/skin-tone-analysis"  # client.run adds the /s2s/v2.0/ prefix
GAIN = 1.10
MIN_BALANCE = 200
UNITS_PER_CALL = 20
THRESHOLDS = {"repeat_de_max": 1.0, "gain_ratio_min": 0.7, "api_vs_patch_de_max": 3.0}


def _own_lab(path: Path) -> np.ndarray:
    """Pooled Lab mean of both cheeks of the image at path (one detection, its own scale)."""
    with Image.open(path) as im:
        img = np.asarray(im.convert("RGB"))
    patches = cheek_patches(img)
    if patches is None:
        raise ValueError("no usable cheek patch (no face or mask too small)")
    mask = patches["left"] | patches["right"]
    return np.asarray(patch_stats(img, mask, patches["scale_px"])["lab_mean"])


def _tone_call(client, file_id: str) -> dict:
    task_id = client.run(ENDPOINT, {"src_file_id": file_id, "face_angle_strictness_level": "high"})
    res = client.poll(ENDPOINT, task_id)
    try:
        skin = res["color"]["skin_color"]
    except (KeyError, TypeError):
        raise YouCamError(
            f"task {task_id} result had no color.skin_color", code="bad_shape", task_id=task_id
        ) from None
    return {"task_id": task_id, "skin_color": skin, "face_quality": res.get("face_quality")}


def _write(out: Path, result: dict) -> None:
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(out.suffix + ".tmp")
    tmp.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    tmp.replace(out)


def _score(calls: list[dict], own_orig, own_gain) -> dict:
    orig, rep, gain = (hex_to_lab(c["skin_color"]) for c in calls)
    repeat_de = de2000(orig, rep)
    own_shift = de2000(own_orig, own_gain)
    api_shift = de2000(orig, gain)
    ratio = api_shift / own_shift if own_shift > 0 else None
    api_vs_patch = de2000(orig, own_orig)
    crit = {
        "repeat": repeat_de <= THRESHOLDS["repeat_de_max"],
        "gain_response": ratio is not None and ratio >= THRESHOLDS["gain_ratio_min"],
        "api_vs_patch": api_vs_patch <= THRESHOLDS["api_vs_patch_de_max"],
    }
    return {
        "repeat_de": repeat_de,
        "gain_response_ratio": ratio,
        "api_vs_patch_de": api_vs_patch,
        "own_gain_shift_de": own_shift,
        "api_gain_shift_de": api_shift,
        "criteria_pass": crit,
        "k2_pass": all(crit.values()),
    }


def run_k2(client, selfie: Path, out: Path, copies_dir: Path) -> int:
    selfie, copies_dir = Path(selfie), Path(copies_dir)
    result: dict = {
        "selfie": selfie.name,
        "gain": GAIN,
        "thresholds": THRESHOLDS,
        "calls": [],
        "k2_pass": False,
    }

    def fail(code: str, message: str, task_id: str | None = None) -> int:
        result["error"] = {"code": code, "task_id": task_id, "message": message}
        _write(out, result)
        print(f"K2 stopped: {code}: {message}", file=sys.stderr)
        return 1

    pf = preflight(selfie)
    result["preflight"] = pf
    if not pf["ok"]:
        return fail("preflight", "; ".join(pf["reasons"]))

    # Offline preparation first: nothing is uploaded or billed until every local step has worked.
    try:
        orig_copy = upload_copy(selfie, copies_dir)
        with Image.open(orig_copy) as im:
            orig_img = np.asarray(im.convert("RGB"))
        gain_raw = copies_dir / f"{selfie.stem}.gain.jpg"
        Image.fromarray(apply_linear_gain(orig_img, GAIN)).save(gain_raw, "JPEG", quality=95)
        gain_copy = upload_copy(gain_raw, copies_dir)
        own_orig = _own_lab(orig_copy)
        own_gain = _own_lab(gain_copy)
    except (ValueError, OSError) as exc:
        return fail("local_prep", str(exc))
    result["own_patch_lab"] = {"original": own_orig.tolist(), "gain": own_gain.tolist()}

    balance_before = None
    try:
        balance_before = client.require_budget(MIN_BALANCE)
        result["balance_before"] = balance_before
        orig_id = client.upload(orig_copy)
        gain_id = client.upload(gain_copy)
        for file_id in (orig_id, orig_id, gain_id):  # original, repeat, gain copy
            result["calls"].append(_tone_call(client, file_id))
    except YouCamError as exc:
        try:
            if balance_before is not None:
                result["balance_after"] = client.balance()
                result["units_spent"] = balance_before - result["balance_after"]
        except YouCamError:
            pass
        return fail(exc.code or "error", str(exc), exc.task_id)

    result["balance_after"] = client.balance()
    result["units_spent"] = balance_before - result["balance_after"]
    result.update(_score(result["calls"], own_orig, own_gain))
    _write(out, result)
    verdict = "PASS" if result["k2_pass"] else "FAIL"
    print(
        f"K2 {verdict}: repeat_de={result['repeat_de']:.2f} "
        f"gain_ratio={result['gain_response_ratio']} "
        f"api_vs_patch_de={result['api_vs_patch_de']:.2f} units={result['units_spent']}"
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="K2 tone-read experiment (spends 60 units)")
    ap.add_argument(
        "--selfie", required=True, help="selfie name, e.g. A (private_inputs/selfies/A.jpg)"
    )
    ap.add_argument("--out", default="recon/gate/k2.json")
    ap.add_argument("--root", default=".", help="project root")
    args = ap.parse_args(argv)
    root = Path(args.root)
    selfie = root / "private_inputs" / "selfies" / f"{args.selfie}.jpg"
    return run_k2(
        YouCamClient(), selfie, root / args.out, root / "private_inputs" / "upload_copies"
    )


if __name__ == "__main__":
    sys.exit(main())

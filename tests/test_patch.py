from pathlib import Path

import cv2
import numpy as np
import pytest
from PIL import Image, ImageOps

from castforecast.patch import cheek_patches, patch_stats

SELFIE = Path(__file__).resolve().parent.parent / "private_inputs" / "selfies" / "A.jpg"


def test_no_face_returns_none():
    grey = np.full((480, 640, 3), 128, dtype=np.uint8)
    assert cheek_patches(grey) is None


def test_patch_stats_on_uniform_color():
    img = np.full((200, 200, 3), 128, dtype=np.uint8)  # #808080
    mask = np.zeros((200, 200), dtype=bool)
    mask[50:150, 50:150] = True
    s = patch_stats(img, mask, 300.0)
    assert abs(s["lab_mean"][0] - 53.585) < 0.1
    assert abs(s["lab_mean"][1]) < 0.1 and abs(s["lab_mean"][2]) < 0.1
    assert np.all(np.asarray(s["lab_std"]) < 1e-6)
    assert s["hf_energy"] < 1e-6


def test_patch_stats_rejects_empty_mask():
    img = np.full((20, 20, 3), 128, dtype=np.uint8)
    with pytest.raises(ValueError):
        patch_stats(img, np.zeros((20, 20), dtype=bool), 300.0)


def test_patches_redetected_on_resized_output():
    if not SELFIE.exists():
        pytest.skip("private_inputs/selfies/A.jpg not present (CI has no selfie)")
    with Image.open(SELFIE) as im:
        full = np.asarray(ImageOps.exif_transpose(im).convert("RGB"))
    half = np.asarray(
        Image.fromarray(full).resize((full.shape[1] // 2, full.shape[0] // 2), Image.LANCZOS)
    )
    out = cheek_patches(half)
    ref = cheek_patches(full)
    assert out is not None and ref is not None
    assert abs(out["scale_px"] * 2 - ref["scale_px"]) / ref["scale_px"] < 0.05
    for side in ("left", "right"):
        m = out[side]
        assert m.shape == half.shape[:2] and m.dtype == bool
        assert m.sum() > 200
        r = ref[side]
        ys, xs = np.nonzero(m)
        ry, rx = np.nonzero(r)
        assert abs(xs.mean() / m.shape[1] - rx.mean() / r.shape[1]) < 0.02
        assert abs(ys.mean() / m.shape[0] - ry.mean() / r.shape[0]) < 0.02
        up = cv2.resize(
            m.astype(np.uint8), (r.shape[1], r.shape[0]), interpolation=cv2.INTER_NEAREST
        )
        iou = (up.astype(bool) & r).sum() / (up.astype(bool) | r).sum()
        assert iou >= 0.8
    assert not (out["left"] & out["right"]).any()


def test_hf_energy_is_resolution_independent():
    rng = np.random.default_rng(1)
    noise = cv2.GaussianBlur(rng.normal(size=(800, 800)), (0, 0), 3.0)
    noise = noise / noise.std()
    full = np.clip(128 + 12 * noise, 0, 255).astype(np.uint8)
    full = np.stack([full] * 3, axis=-1)
    half = cv2.resize(full, (400, 400), interpolation=cv2.INTER_AREA)
    mask = np.zeros((800, 800), dtype=bool)
    mask[200:600, 200:600] = True
    mask_half = np.zeros((400, 400), dtype=bool)
    mask_half[100:300, 100:300] = True
    a = patch_stats(full, mask, 400.0)["hf_energy"]
    b = patch_stats(half, mask_half, 200.0)["hf_energy"]
    assert a > 0.005
    assert abs(a - b) / a < 0.15

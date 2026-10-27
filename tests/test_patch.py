from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from castforecast.patch import cheek_patches, patch_stats

SELFIE = Path(__file__).resolve().parent.parent / "private_inputs" / "selfies" / "A.jpg"


def test_no_face_returns_none():
    grey = np.full((480, 640, 3), 128, dtype=np.uint8)
    assert cheek_patches(grey) is None


def test_patch_stats_on_uniform_color():
    img = np.full((200, 200, 3), 128, dtype=np.uint8)  # #808080
    mask = np.zeros((200, 200), dtype=bool)
    mask[50:150, 50:150] = True
    s = patch_stats(img, mask)
    assert abs(s["lab_mean"][0] - 53.585) < 0.1
    assert abs(s["lab_mean"][1]) < 0.1 and abs(s["lab_mean"][2]) < 0.1
    assert np.all(np.asarray(s["lab_std"]) < 1e-6)
    assert s["hf_energy"] < 1e-6


def test_patch_stats_rejects_empty_mask():
    img = np.full((20, 20, 3), 128, dtype=np.uint8)
    with pytest.raises(ValueError):
        patch_stats(img, np.zeros((20, 20), dtype=bool))


def test_patches_redetected_on_resized_output():
    if not SELFIE.exists():
        pytest.skip("private_inputs/selfies/A.jpg not present (CI has no selfie)")
    with Image.open(SELFIE) as im:
        full = np.asarray(im.convert("RGB"))
    half = np.asarray(
        Image.fromarray(full).resize((full.shape[1] // 2, full.shape[0] // 2), Image.LANCZOS)
    )
    out = cheek_patches(half)
    assert out is not None
    for side in ("left", "right"):
        m = out[side]
        assert m.shape == half.shape[:2] and m.dtype == bool
        assert m.sum() > 100
    assert not (out["left"] & out["right"]).any()

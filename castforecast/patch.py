"""Cheek-patch sampler: re-detects the face on every image and measures skin color and texture.

Face landmarks come from the MediaPipe Tasks FaceLandmarker (478 points, model file fetched by
scripts/fetch_models.py). Coordinates are never carried between images: every call detects again,
so a render at a different size gets masks that fit its own pixels.

Cheek polygons (FaceLandmarker indices, left/right named by image side, not by the subject):
  left  = 118, 101, 36, 205, 187, 50
  right = 347, 330, 266, 425, 411, 280
Each polygon sits below the eye, lateral to the nostril (101/330 and 36/266 are the nose-side
vertices, kept clear of the nostril wing at 129/358), and ends above the mustache and jaw-line
beard zone (205/425 and 187/411 are the lowest vertices). The polygon is then shrunk toward its
centroid by SHRINK so the mask stays inside the cheek, away from eyes, nose, lips, beard and hair.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

from castforecast.color import srgb_to_lab

MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "face_landmarker.task"
LEFT_CHEEK = (118, 101, 36, 205, 187, 50)
RIGHT_CHEEK = (347, 330, 266, 425, 411, 280)
SHRINK = 0.85
BLUR_SIGMA_PX = 5.0

_landmarker = None


def _get_landmarker():
    global _landmarker
    if _landmarker is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"{MODEL_PATH} missing; run scripts/fetch_models.py")
        opts = vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(MODEL_PATH)),
            num_faces=1,
            min_face_detection_confidence=0.5,
        )
        _landmarker = vision.FaceLandmarker.create_from_options(opts)
    return _landmarker


def _polygon_mask(points: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    centre = points.mean(axis=0)
    shrunk = centre + (points - centre) * SHRINK
    mask = np.zeros(shape, dtype=np.uint8)
    cv2.fillPoly(mask, [np.rint(shrunk).astype(np.int32)], 1)
    return mask.astype(bool)


def cheek_patches(img: np.ndarray) -> dict | None:
    """Detect the face in an RGB uint8 image and return {"left", "right"} boolean masks.

    Returns None when no face is found. Masks have the same height and width as img.
    """
    arr = np.asarray(img)
    if arr.dtype != np.uint8 or arr.ndim != 3 or arr.shape[2] != 3:
        raise TypeError("expected uint8 RGB array of shape (H, W, 3)")
    h, w = arr.shape[:2]
    result = _get_landmarker().detect(
        mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(arr))
    )
    if not result.face_landmarks:
        return None
    pts = np.array([[p.x * w, p.y * h] for p in result.face_landmarks[0]])
    masks = {
        "left": _polygon_mask(pts[list(LEFT_CHEEK)], (h, w)),
        "right": _polygon_mask(pts[list(RIGHT_CHEEK)], (h, w)),
    }
    if not masks["left"].any() or not masks["right"].any():
        return None
    return masks


def patch_stats(img: np.ndarray, mask: np.ndarray) -> dict:
    """Color and texture statistics of the pixels of img (RGB uint8) inside mask.

    lab_mean, lab_std: per-channel mean and standard deviation of CIELAB (D65) over the mask.
    hf_energy: standard deviation, over the mask, of the high-pass luminance
      hp = Y - GaussianBlur(Y, sigma=5 px), where Y = 0.2126 R + 0.7152 G + 0.0722 B is computed
      on the full image from gamma-encoded sRGB values scaled to 0..1 and the blur is applied to
      the whole image before masking (so mask edges do not create false texture).
    """
    arr = np.asarray(img)
    m = np.asarray(mask, dtype=bool)
    if arr.shape[:2] != m.shape:
        raise ValueError(f"mask shape {m.shape} does not match image {arr.shape[:2]}")
    if not m.any():
        raise ValueError("mask is empty")
    lab = srgb_to_lab(arr)[m]
    unit = arr.astype(np.float64) / 255.0 if arr.dtype == np.uint8 else arr.astype(np.float64)
    y = unit @ np.array([0.2126, 0.7152, 0.0722])
    hp = y - cv2.GaussianBlur(y, (0, 0), BLUR_SIGMA_PX)
    return {
        "lab_mean": lab.mean(axis=0),
        "lab_std": lab.std(axis=0),
        "hf_energy": float(hp[m].std()),
    }

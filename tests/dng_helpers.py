"""Write small linear DNG files (the layout Apple ProRAW uses) for decoder tests."""

import numpy as np
import tifffile

# XYZ to linear sRGB, so the synthetic camera's colour space is linear sRGB itself.
_XYZ_TO_SRGB = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.2040, 1.0570]


def _rationals(values, den):
    out = []
    for v in values:
        out += [round(float(v) * den), den]
    return tuple(out)


def linear_dng(path, data: np.ndarray, white: int = 16383, neutral=(0.5, 1.0, 2 / 3)):
    """A LinearRaw DNG holding `data` (H, W, 3 uint16), with AsShotNeutral `neutral` (camera
    white balance multipliers 1 / neutral) and one white level for all channels."""
    tags = [
        (50706, 1, 4, (1, 4, 0, 0), True),  # DNGVersion
        (50707, 1, 4, (1, 1, 0, 0), True),  # DNGBackwardVersion
        (50708, 2, 0, "Synthetic", True),  # UniqueCameraModel
        (50717, 4, 1, (white,), True),  # WhiteLevel
        (50714, 4, 1, (0,), True),  # BlackLevel
        (50721, 10, 9, _rationals(_XYZ_TO_SRGB, 10000), True),  # ColorMatrix1
        (50778, 3, 1, (21,), True),  # CalibrationIlluminant1 = D65
        (50728, 5, 3, _rationals(neutral, 1_000_000), True),  # AsShotNeutral
    ]
    tifffile.imwrite(
        path,
        np.asarray(data, np.uint16),
        photometric=34892,  # LinearRaw
        planarconfig="contig",
        subfiletype=0,
        extratags=tags,
        metadata=None,
    )
    return path

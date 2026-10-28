"""Write small DNG files for decoder tests: linear DNGs in the layout Apple ProRAW uses, plus the
variants the decoder must refuse."""

import numpy as np
import tifffile

# XYZ to linear sRGB, so the synthetic camera's colour space is linear sRGB itself.
_XYZ_TO_SRGB = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.2040, 1.0570]


def _rationals(values, den):
    out = []
    for v in values:
        out += [round(float(v) * den), den]
    return tuple(out)


def linear_dng(
    path,
    data: np.ndarray,
    white=16383,
    neutral=(0.5, 1.0, 2 / 3),
    black=(0,),
    lut=None,
    photometric=34892,  # LinearRaw; 32803 is a Bayer CFA
    extra=(),  # more tifffile extratags
):
    """A DNG holding `data` (H, W, 3 uint16 for linear, H, W for CFA), with AsShotNeutral
    `neutral` (white balance multipliers 1 / neutral), WhiteLevel `white` (one value or one per
    channel), BlackLevel `black` and an optional LinearizationTable `lut`."""
    white = tuple(np.atleast_1d(white).tolist())
    tags = [
        (50706, 1, 4, (1, 4, 0, 0), True),  # DNGVersion
        (50707, 1, 4, (1, 1, 0, 0), True),  # DNGBackwardVersion
        (50708, 2, 0, "Synthetic", True),  # UniqueCameraModel
        (50717, 4, len(white), white, True),  # WhiteLevel
        (50714, 4, len(black), tuple(black), True),  # BlackLevel
        (50721, 10, 9, _rationals(_XYZ_TO_SRGB, 10000), True),  # ColorMatrix1
        (50778, 3, 1, (21,), True),  # CalibrationIlluminant1 = D65
        (50728, 5, 3, _rationals(neutral, 1_000_000), True),  # AsShotNeutral
    ]
    if lut is not None:
        tags.append((50712, 3, len(lut), tuple(int(v) for v in lut), True))
    tags += list(extra)
    kwargs = {"planarconfig": "contig"} if np.ndim(data) == 3 else {}
    tifffile.imwrite(
        path,
        np.asarray(data, np.uint16),
        photometric=photometric,
        subfiletype=0,
        extratags=tags,
        metadata=None,
        **kwargs,
    )
    return path

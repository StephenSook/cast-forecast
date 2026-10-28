"""Single-layer film physics for Gate 2 (docs/gates/gate2-preregistration.md).

A sunscreen film of reflectance R and transmittance T laid over a substrate of reflectance rho
shows rho' = R + T^2 rho / (1 - R rho) (diffuse light, one channel). Measured over a black and a
white substrate, the two equations give R and T in closed form: the R^2 terms cancel, so R is
linear. `scaled` changes the film's thickness with the Kubelka layer formulas. `lightness` turns
linear sRGB reflectance into CIE L*.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

_EPS = 1e-12


@dataclass(frozen=True)
class LayerFilm:
    """Diffuse reflectance r and transmittance t of a film, one channel."""

    r: float
    t: float


def over(r: float, t: float, rho: float) -> float:
    """Reflectance of a film (r, t) laid over a substrate of reflectance rho."""
    return r + t * t * rho / (1.0 - r * rho)


def accept(r: float, t2: float):
    """Gate 2 Amendment 2 rule 6: the accepted film for a raw solve (R, T^2), or None.

    Accepted when -0.02 <= R <= 1, T^2 >= -0.02 and R + T <= 1.03 (T from the clamped T^2);
    then negatives are set to zero and, if R + T > 1, T = 1 - R (a non-absorbing film).
    """
    if not (-0.02 <= r <= 1.0) or t2 < -0.02:
        return None
    r = max(r, 0.0)
    t = math.sqrt(max(t2, 0.0))
    if r + t > 1.03 + _EPS:
        return None
    if r + t > 1.0:
        t = 1.0 - r
    return LayerFilm(r, t)


def solve_film(black: float, black_coated: float, white: float, white_coated: float):
    """The accepted film (R, T) that turns bare reflectances into the coated ones, or None.

    None when the substrates carry no information or the raw solve is not accepted (`accept`).
    T^2 comes from the white equation, so a black substrate measured at zero still solves (R is
    then the coated black reading); with both equations exact, either one gives the same T^2.
    """
    den = white - black + black * white * (black_coated - white_coated)
    if abs(den) < _EPS or black < 0 or white <= 0:
        return None
    r = (black_coated * white - white_coated * black) / den
    t2 = (white_coated - r) * (1.0 - r * white) / white
    return accept(r, t2)


def scaled(film: LayerFilm, thickness: float) -> LayerFilm:
    """The same film material at `thickness` times its measured thickness (Kubelka layer formulas).

    Cases in Gate 2 Amendment 2 rule 6 order: an opaque film (t = 0) is unchanged; a film that
    only absorbs (r = 0) has t ** thickness; a film that only scatters (r + t = 1) uses the K = 0
    formulas, where the general ones are singular. Raises ValueError for a non-positive thickness
    or a film with r + t > 1.
    """
    if thickness <= 0:
        raise ValueError("thickness must be positive")
    r, t = film.r, film.t
    if t < _EPS:
        return LayerFilm(r, 0.0)
    if r < _EPS:
        return LayerFilm(0.0, t**thickness)
    if abs(r + t - 1.0) <= 1e-9:
        q = r / t * thickness
        return LayerFilm(q / (1.0 + q), 1.0 / (1.0 + q))
    a = (1.0 + r * r - t * t) / (2.0 * r)
    if a <= 1.0:
        raise ValueError("film is not admissible for the Kubelka formulas")
    b = math.sqrt(a * a - 1.0)
    sx = math.log((1.0 - r * (a - b)) / t) / b  # scattering coefficient x thickness
    y = b * sx * thickness
    if y > 300.0:  # sinh and cosh overflow; the layer is effectively infinitely thick
        return LayerFilm(1.0 / (a + b), 0.0)
    sh, ch = math.sinh(y), math.cosh(y)
    den = a * sh + b * ch
    return LayerFilm(sh / den, b / den)


def lightness(rgb_linear: np.ndarray) -> float:
    """CIE L* of a linear sRGB (D65) reflectance triple, with a perfect white at Y = 1."""
    y = float(0.2126 * rgb_linear[0] + 0.7152 * rgb_linear[1] + 0.0722 * rgb_linear[2])
    eps = (6.0 / 29.0) ** 3
    f = y ** (1.0 / 3.0) if y > eps else y / (3.0 * (6.0 / 29.0) ** 2) + 4.0 / 29.0
    return 116.0 * f - 16.0

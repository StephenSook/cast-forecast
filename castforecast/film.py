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


def solve_film(black: float, black_coated: float, white: float, white_coated: float):
    """The film (R, T) that turns bare reflectances into the coated ones, or None.

    None when the substrates carry no information or no admissible film exists
    (R >= 0, T >= 0, R + T <= 1).
    """
    den = white - black + black * white * (black_coated - white_coated)
    if abs(den) < _EPS or black <= 0 or white <= 0:
        return None
    r = (black_coated * white - white_coated * black) / den
    t2 = (black_coated - r) * (1.0 - r * black) / black
    if -_EPS < r < 0:
        r = 0.0
    if -_EPS < t2 < 0:
        t2 = 0.0
    if r < 0 or t2 < 0:
        return None
    t = math.sqrt(t2)
    if r + t > 1.0 + 1e-9:
        return None
    return LayerFilm(r, t)


def scaled(film: LayerFilm, thickness: float) -> LayerFilm:
    """The same film material at `thickness` times its measured thickness (Kubelka layer formulas).

    A non-scattering film (r = 0) only absorbs: t becomes t ** thickness. An opaque film (t = 0)
    keeps its reflectance. Raises ValueError for a non-positive thickness or an inadmissible film.
    """
    if thickness <= 0:
        raise ValueError("thickness must be positive")
    r, t = film.r, film.t
    if r < _EPS:
        return LayerFilm(0.0, t**thickness)
    if t < _EPS:
        return LayerFilm(r, 0.0)
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

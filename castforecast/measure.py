"""Gate 2 measurement: decoded frames and corner dots in, reflectances, films and whitening out.

Follows docs/gates/gate2-preregistration.md with its amendments:
- reflectance per channel = region mean / white-paper mean x the paper's assumed reflectance;
- a bottle's film comes from its black and white cards at T15 flash off, one accepted solve per
  channel, all three at paper scale 0.88, or the film is unusable (Amendment 1 rule 2);
- an arm is valid only with every square measurable on BASE and T15 flash off and the untreated
  square's drift within 1.5 L*; validity is decided before any whitening value exists (rule 3);
- forearm bottles: at most one organic-only control, then the highest label mineral percent.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from castforecast import regions
from castforecast.film import lightness, solve_film
from castforecast.gate2 import Film3
from castforecast.raw import Decoded, region_mean

PAPER_R = 0.88
MAX_DRIFT = 1.5  # L*, untreated square between BASE and T15
FOREARM_SQUARES = 4


@dataclass(frozen=True)
class Bottle:
    code: str
    m: float  # zinc oxide % + titanium dioxide % from the label; 0 for an organic-only control


def forearm_bottles(bottles: list[Bottle], n: int = FOREARM_SQUARES) -> list[str]:
    """At most one organic-only control, then the highest m; ties go to the code that sorts first."""
    controls = sorted(b.code for b in bottles if b.m == 0)
    minerals = [
        b.code for b in sorted((b for b in bottles if b.m > 0), key=lambda b: (-b.m, b.code))
    ]
    return (controls[:1] + minerals)[:n]


def reflectance(region: np.ndarray, paper: np.ndarray, paper_r: float = PAPER_R) -> np.ndarray:
    return np.asarray(region, float) / np.asarray(paper, float) * paper_r


def _mean(d: Decoded, polys) -> np.ndarray | None:
    mask = np.zeros(d.clipped.shape, bool)
    for p in polys:
        mask |= regions.polygon_mask(p, d.clipped.shape)
    return region_mean(d, mask)


def frame_regions(
    d: Decoded, paper_corners, windows: dict, card: bool, paper_r: float = PAPER_R
) -> dict:
    """Per window: {"treated": rgb, "bare": rgb (cards only)} with None for an unusable region,
    or {"error": why} when its dots cannot make a window. Every window fails if the paper does."""
    try:
        paper = _mean(d, [regions.paper(paper_corners)])
    except ValueError as e:
        paper, why = None, f"paper: {e}"
    else:
        why = "paper unusable"
    if paper is None:
        return {name: {"error": why} for name in windows}
    out = {}
    for name, dots in windows.items():
        try:
            treated = _mean(d, [regions.treated(dots)])
            bare = _mean(d, regions.bare(dots)) if card else None
        except ValueError as e:
            out[name] = {"error": str(e)}
            continue
        entry = {"treated": None if treated is None else reflectance(treated, paper, paper_r)}
        if card:
            entry["bare"] = None if bare is None else reflectance(bare, paper, paper_r)
        out[name] = entry
    return out


def card_film(black: tuple, white: tuple) -> Film3 | None:
    """The bottle's film from (bare, coated) reflectances of its black and white cards, or None."""
    (bb, bc), (wb, wc) = black, white
    if any(x is None for x in (bb, bc, wb, wc)):
        return None
    film = tuple(solve_film(bb[c], bc[c], wb[c], wc[c]) for c in range(3))
    return None if any(f is None for f in film) else film


def _problem(frame: dict, square: str) -> str | None:
    entry = frame.get(square)
    if entry is None:
        return "no dots"
    if "error" in entry:
        return entry["error"]
    if entry.get("treated") is None:
        return "region unusable"
    return None


def arm_result(base: dict, t15: dict, treated=("A", "B"), control: str = "U") -> dict:
    """Validity first; whitening only for a valid arm (drift-corrected by the untreated square)."""
    reasons = [
        f"{sq} at {name}: {why}"
        for name, frame in (("BASE", base), ("T15", t15))
        for sq in (*treated, control)
        if (why := _problem(frame, sq))
    ]
    if reasons:
        return {"valid": False, "reasons": reasons}
    drift = lightness(t15[control]["treated"]) - lightness(base[control]["treated"])
    if abs(drift) > MAX_DRIFT:
        return {
            "valid": False,
            "drift": drift,
            "reasons": [f"untreated drift {drift:+.2f} L* exceeds 1.5"],
        }
    obs = {
        sq: lightness(t15[sq]["treated"]) - lightness(base[sq]["treated"]) - drift for sq in treated
    }
    return {
        "valid": True,
        "drift": drift,
        "obs": obs,
        "base": {sq: base[sq]["treated"] for sq in treated},
    }

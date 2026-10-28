"""Held-out test of the Cast Forecast film model on the PLOS ONE 2025 raw data.

Source data: Maldonado Lopez et al., PLOS ONE 2025 (doi 10.1371/journal.pone.0319891),
Mendeley Data deposit jfpzx7hcz2 v2: per-volunteer in-vivo L* before/after (13 volunteers,
6 formulations, 3 replicate pairs) and in-vitro L* on VITRO-SKIN over black and white.

PRE-REGISTERED GATE (written before the first run, 2026-10-27 ~18:40 ET):
  Compare, on ZnO > 0 cells only, in STRICT leave-one-cell-out (calibration excludes the
  held-out volunteer AND the held-out formulation), the film model F2 (2 params: film
  thickness scale t, score offset a) against the label-percent baseline B1i (2 params:
  paper's own normalisation, dL* = (a + c * ZnO%) * (100 - L*before)).
  PASS if BOTH:
    (1) F2 overall MAE < B1i overall MAE, and
    (2) on the 14.7% benchmark (a differently formulated product), F2 MAE < B1i MAE.
  Report the dark-skin subgroup (ITA Brown + Tan) separately; report everything else as
  descriptive. Do not change model forms after seeing results; any later variant is
  labelled post hoc.
"""
import math
import os
import statistics as st
import sys

import numpy as np
import openpyxl
from scipy.optimize import brentq, least_squares, minimize_scalar

DATA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "data", "plos2025_mendeley")

ZN = {"0% ZnO": 0.0, "5% ZnO": 5.0, "10% ZnO": 10.0, "20% ZnO": 20.0,
      "30% ZnO": 30.0, "14.7% ZnO Benchmark": 14.7}
BM = "14.7% ZnO Benchmark"


def L2Y(L):
    return ((L + 16.0) / 116.0) ** 3 if L > 8 else L / 903.3


def Y2L(Y):
    return 116.0 * Y ** (1 / 3) - 16.0 if Y > 0.008856 else 903.3 * Y


def read_rows(path):
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    out, ff = [], [None, None, None]
    for r in rows[1:]:
        if r[3] is None or r[4] is None:
            continue
        for i in range(3):
            if r[i] is not None:
                ff[i] = r[i]
        lb, la = float(r[3]), float(r[4])
        # Validity filter added after the first run exposed one impossible value:
        # invivo.xlsx row 178 (A839, 30% ZnO) has L* before = 533.92, outside the 0-100
        # scale (a decimal-point entry error). Impossible readings are DROPPED, never guessed.
        if not (0.0 <= lb <= 100.0 and 0.0 <= la <= 100.0):
            DROPPED.append((os.path.basename(path), ff[:], lb, la))
            continue
        out.append((ff[0], ff[1], ff[2], lb, la))
    return out


DROPPED = []


# ---------- in vivo cells ----------
vivo = read_rows(os.path.join(DATA, "invivo.xlsx"))
cells = {}
for ita, vid, form, lb, la in vivo:
    cells.setdefault((vid, form), {"ita": ita, "pairs": []})["pairs"].append((lb, la))
for k, c in cells.items():
    lbs = [p[0] for p in c["pairs"]]
    las = [p[1] for p in c["pairs"]]
    dls = [p[1] - p[0] for p in c["pairs"]]
    c.update(Lb=st.mean(lbs), La=st.mean(las), dL=st.mean(dls),
             sem=(st.stdev(dls) / math.sqrt(len(dls))) if len(dls) > 1 else float("nan"))
subjects = sorted({k[0] for k in cells})
ita_of = {k[0]: c["ita"] for k, c in cells.items()}
DARK = {s for s in subjects if ita_of[s] in ("Brown", "Tan")}

# ---------- in vitro films ----------
vitro = read_rows(os.path.join(DATA, "invitro.xlsx"))
vt = {}
for bg, rep, form, lb, la in vitro:
    vt.setdefault((bg, form), []).append((lb, la))
film = {}
solve_log = []
for form in ZN:
    b = vt[("Black", form)]
    w = vt[("White", form)]
    Rb0, Rb = L2Y(st.mean(p[0] for p in b)), L2Y(st.mean(p[1] for p in b))
    Rw0, Rw = L2Y(st.mean(p[0] for p in w)), L2Y(st.mean(p[1] for p in w))

    def t2(R0, Rg, R):
        return (R - R0) * (1 - R0 * Rg) / Rg

    g = lambda R0: t2(R0, Rb0, Rb) - t2(R0, Rw0, Rw)
    lo, hi = 1e-9, min(Rb, 0.999) - 1e-9
    if g(lo) * g(hi) > 0:
        solve_log.append(f"{form}: NO BRACKET (g(lo)={g(lo):.4g}, g(hi)={g(hi):.4g}); film unusable")
        continue
    R0 = brentq(g, lo, hi)
    T2 = t2(R0, Rb0, Rb)
    T = math.sqrt(max(T2, 0.0))
    a = (1 + R0 * R0 - T2) / (2 * R0) if R0 > 0 else float("inf")
    phys = (R0 + T) <= 1.0 and a > 1.0
    entry = dict(R0=R0, T2=T2, T=T, a=a, physical=phys)
    if phys:
        b_ = math.sqrt(a * a - 1)
        z = (1 / R0 - a) / b_
        entry["bSX"] = 0.5 * math.log((z + 1) / (z - 1))
        entry["b"] = b_
    film[form] = entry
    solve_log.append(f"{form}: R0={R0:.4f} T={T:.4f} R0+T={R0 + T:.4f} physical={phys}")


def film_scaled(form, t):
    f = film[form]
    if not f["physical"]:
        return f["R0"], f["T2"]  # cannot scale; return as measured
    a, b, bSX = f["a"], f["b"], f["bSX"] * t
    den = a * math.sinh(bSX) + b * math.cosh(bSX)
    return math.sinh(bSX) / den, (b / den) ** 2


def film_pred_dL(form, Lb, t):
    R0, T2 = film_scaled(form, t)
    Rg = L2Y(Lb)
    return Y2L(R0 + T2 * Rg / (1 - R0 * Rg)) - Lb


# ---------- models: fit(train_cells) -> predict(cell) ----------
def fit_B0(train):
    by = {}
    for (s, f) in train:
        by.setdefault(f, []).append(cells[(s, f)]["dL"])
    m = {f: st.mean(v) for f, v in by.items()}
    return lambda s, f: m.get(f, float("nan"))


def fit_B1i(train):
    X = np.array([[100 - cells[k]["Lb"], ZN[k[1]] * (100 - cells[k]["Lb"])] for k in train])
    y = np.array([cells[k]["dL"] for k in train])
    a, c = np.linalg.lstsq(X, y, rcond=None)[0]
    return lambda s, f: (a + c * ZN[f]) * (100 - cells[(s, f)]["Lb"])


def fit_F0(train):
    return lambda s, f: film_pred_dL(f, cells[(s, f)]["Lb"], 1.0)


def fit_F2(train):
    tr = [k for k in train if k[1] in film]

    def resid(p):
        t, a = p
        return [film_pred_dL(k[1], cells[k]["Lb"], t) + a * (100 - cells[k]["Lb"]) - cells[k]["dL"]
                for k in tr]

    r = least_squares(resid, x0=[0.6, 0.0], bounds=([0.02, -0.2], [3.0, 0.2]))
    t, a = r.x
    return lambda s, f: film_pred_dL(f, cells[(s, f)]["Lb"], t) + a * (100 - cells[(s, f)]["Lb"])


def fit_F1(train):
    tr = [k for k in train if k[1] in film]
    r = minimize_scalar(lambda t: sum((film_pred_dL(k[1], cells[k]["Lb"], t) - cells[k]["dL"]) ** 2
                                      for k in tr), bounds=(0.02, 3.0), method="bounded")
    t = r.x
    return lambda s, f: film_pred_dL(f, cells[(s, f)]["Lb"], t)


MODELS = {"B0 product avg (needs wearer panel)": fit_B0,
          "B1i label% (paper score, 2p)": fit_B1i,
          "F0 film, no calibration": fit_F0,
          "F1 film + thickness (1p)": fit_F1,
          "F2 film + thickness + offset (2p)": fit_F2}

TARGET = [k for k in cells if ZN[k[1]] > 0 and k[1] in film]


def evaluate(scheme):
    preds = {m: {} for m in MODELS}
    for k in TARGET:
        s, f = k
        if scheme == "LOSO":
            train = [j for j in cells if j[0] != s]
        elif scheme == "LOFO":
            train = [j for j in cells if j[1] != f]
        else:  # strict leave-one-cell-out
            train = [j for j in cells if j[0] != s and j[1] != f]
        for m, fitter in MODELS.items():
            preds[m][k] = fitter(train)(s, f)
    return preds


def stats(errs):
    errs = [e for e in errs if not math.isnan(e)]
    if not errs:
        return "n/a"
    mae = st.mean(abs(e) for e in errs)
    rmse = math.sqrt(st.mean(e * e for e in errs))
    return f"MAE {mae:5.2f}  RMSE {rmse:5.2f}  max {max(abs(e) for e in errs):5.2f}  n={len(errs)}"


def report(scheme, preds):
    print(f"\n===== {scheme} (ZnO > 0 cells; error in L* units, predicted minus observed) =====")
    for m in MODELS:
        p = preds[m]
        all_e = [p[k] - cells[k]["dL"] for k in TARGET]
        dark_e = [p[k] - cells[k]["dL"] for k in TARGET if k[0] in DARK]
        bm_e = [p[k] - cells[k]["dL"] for k in TARGET if k[1] == BM]
        print(f"{m:38s} all: {stats(all_e)}")
        print(f"{'':38s} dark: {stats(dark_e)}")
        print(f"{'':38s} benchmark: {stats(bm_e)}")


if __name__ == "__main__":
    print(f"Dropped impossible readings: {DROPPED}")
    print("Film solve from in-vitro black/white means:")
    for line in solve_log:
        print("  " + line)
    sems = [cells[k]["sem"] for k in TARGET]
    print(f"\nVolunteers: {len(subjects)}; dark (ITA Brown/Tan): {sorted(DARK)}")
    print(f"Replicate noise floor (SEM of per-cell dL*): median {st.median(sems):.2f}, "
          f"RMS {math.sqrt(st.mean(x * x for x in sems)):.2f} L*")
    print(f"Observed dL* on benchmark: " + ", ".join(
        f"{s}:{cells[(s, BM)]['dL']:+.2f}" for s in subjects))
    res = {}
    for scheme in ["LOSO", "LOFO", "STRICT"]:
        res[scheme] = evaluate(scheme)
        report(scheme, res[scheme])

    p = res["STRICT"]
    def mae(m, sel):
        e = [abs(p[m][k] - cells[k]["dL"]) for k in TARGET if sel(k)]
        return st.mean(e)
    F, B = "F2 film + thickness + offset (2p)", "B1i label% (paper score, 2p)"
    c1 = mae(F, lambda k: True) < mae(B, lambda k: True)
    c2 = mae(F, lambda k: k[1] == BM) < mae(B, lambda k: k[1] == BM)
    print("\n===== PRE-REGISTERED GATE (STRICT leave-one-cell-out) =====")
    print(f"(1) overall MAE  F2 {mae(F, lambda k: True):.2f} vs B1i {mae(B, lambda k: True):.2f} -> {'PASS' if c1 else 'FAIL'}")
    print(f"(2) benchmark MAE F2 {mae(F, lambda k: k[1] == BM):.2f} vs B1i {mae(B, lambda k: k[1] == BM):.2f} -> {'PASS' if c2 else 'FAIL'}")
    print(f"dark subgroup MAE F2 {mae(F, lambda k: k[0] in DARK):.2f} vs B1i {mae(B, lambda k: k[0] in DARK):.2f} (descriptive)")
    print("GATE:", "PASS" if (c1 and c2) else "FAIL")

"""POST HOC variant (written AFTER the pre-registered gate failed; cannot change that verdict).

Defect found in the pre-registered model: for the 10, 20 and 30% films the black/white solve
gives R0 + T slightly above 1 (non-physical), and film_scaled() then silently skipped the
thickness calibration, so those films were applied at full lab thickness. This variant
projects each non-physical film onto the physical boundary (T = 0.999 - R0, R0 kept) so the
thickness scale applies to every film. Same calibration schemes and baselines.
Any result here is exploratory and must be re-tested prospectively on new data.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import heldout_test as H  # noqa: E402

for form, f in H.film.items():
    if not f["physical"]:
        T = 0.999 - f["R0"]
        f.update(T=T, T2=T * T, projected=True)
        f["a"] = (1 + f["R0"] ** 2 - f["T2"]) / (2 * f["R0"])
        f["physical"] = f["a"] > 1.0
        if f["physical"]:
            f["b"] = math.sqrt(f["a"] ** 2 - 1)
            z = (1 / f["R0"] - f["a"]) / f["b"]
            f["bSX"] = 0.5 * math.log((z + 1) / (z - 1))

H.MODELS = {k: v for k, v in H.MODELS.items() if not k.startswith("B0")}
print("POST HOC: non-physical films projected to R0 + T = 0.999")
for form, f in H.film.items():
    print(f"  {form}: R0={f['R0']:.4f} T={f['T']:.4f} projected={f.get('projected', False)}")
res = H.evaluate("STRICT")
H.report("STRICT, POST HOC projection", res)

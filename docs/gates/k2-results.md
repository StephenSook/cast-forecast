# K2 results: is YouCam's skin tone analysis a usable measurement of a photo?

Run on 2026-10-27 at about 18:51 ET with the code at commit 53e3882. 3 skin tone calls, 60 API units (balance 1000 to 940). One selfie (photo A), sent as a metadata-free sRGB upload copy.

## Pass rule (written before the run)
The rule is in the module docstring of `castforecast/k2_tone.py`, committed at 043293a before the run. All three criteria must hold:

1. Repeat: dE00 between two calls on the same image is at most 1.0.
2. Gain response: dE00(API original, API gain copy) / dE00(own cheek original, own cheek gain copy) is at least 0.7, where the gain copy is the same image made 10 percent brighter in linear light.
3. Agreement: dE00 between the API skin colour and our own cheek measurement (pixel-weighted Lab mean of both cheek patches on the uploaded image) is at most 3.0.

Two amendments were committed at 53e3882, still before the run: the repeat call uses a fresh upload of the same image (so a per-file cache cannot make it pass), and the gain-response ratio counts as undefined, and criterion 2 fails, when our own cheek moves less than 0.5 dE00 under the gain.

## Result

| Criterion | Bar | Measured | Result |
|---|---|---|---|
| 1. Repeat | <= 1.0 | 0.00 (both calls returned #a17758) | PASS |
| 2. Gain response | >= 0.7 | 0.152 (API moved 0.33 dE00, our cheek moved 2.18 dE00; gain call returned #a07758) | FAIL |
| 3. Agreement with our cheek | <= 3.0 | 15.11 (API #a17758 vs our cheek Lab 70.4, 17.5, 22.2) | FAIL |

Verdict: **FAIL** (2 of 3 criteria failed).

Decision: the project plan, written before the run, said a K2 failure on its own means continuing with our own cheek measurement as the skin colour input. The YouCam tone value is kept only as a displayed cross-check.

Reading, not pre-registered and not part of the verdict: the value is repeatable but does not follow the pixels, which fits a tone that is normalized for lighting rather than measured from the photo.

## Limits
One person, one photo, one lighting condition, one gain step, one run.

## Published data
[k2-results.json](k2-results.json) was written by `scripts/publish_results.py` from the private run file. Removed: the input file name (`selfie`), the upload file ids (`file_ids`, and `file_id` in each of the 3 calls), the task id in each of the 3 calls, and the size of the original photo (`preflight` bytes, width, height and short side). Every other field and every number is unchanged.

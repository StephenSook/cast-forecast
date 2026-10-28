# Cast Forecast gate harness

## What this is
The gate harness behind Cast Forecast. It tests, on one consenting person's selfies, two things the product would depend on:

- K2: whether YouCam's skin tone analysis is a usable measurement of the colour in a photo.
- K1 and K1b: whether YouCam's Makeup VTO foundation effect can render a sunscreen-like white film on a face.

Each gate has a pass rule written down before its data existed, and every result is published whichever way it landed. Gate 1 is a separate held-out test on published study data, with no YouCam calls.

## Status
- Gate 1: FAIL. A film model did not beat the label's zinc percentage at predicting on-skin whitening.
- K2: FAIL. The skin colour input comes from our own cheek measurement; the YouCam tone value is kept only as a cross-check.
- K1: FAIL on 4 of 5 criteria, with coverage as the dose.
- K1b: PASS 5 of 5, with colorIntensity as the dose.

Rules, results and timing for each gate: [docs/gates/README.md](docs/gates/README.md).

## Run the tests (no API key needed)
Python 3.12. The same steps run in CI (`.github/workflows/ci.yml`).

```
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install --require-hashes -r requirements.lock
python scripts/fetch_models.py
ruff check .
ruff format --check .
pytest -q
```

- `requirements.lock` pins every package with hashes, including ruff, so lint and format results match CI. It is generated from `requirements.in` with `uv pip compile` (the command is in the file header).
- `scripts/fetch_models.py` downloads the MediaPipe face landmarker model into `models/` and checks it against a pinned SHA-256.
- On Linux, MediaPipe also needs `sudo apt-get install -y libegl1 libgles2`.
- One test skips when the private selfie is absent (it needs a real face). Everything else runs anywhere.
- The YouCam client is tested only through fake transports and connections. No test calls the YouCam API or needs a key.

## Live runs
These spend YouCam API units and need the key in the macOS Keychain under the service name `youcam-api-key`. Each run checks the balance before uploading anything and stops if it is under 200 units.

| Run | Command | Units |
|---|---|---|
| K2 | `python -m castforecast.k2_tone --selfie A` | 60 |
| K1 | `python -m castforecast.k1_render --selfie A --check B` | 42 |
| K1b | `python -m castforecast.k1b_render --selfie A --check B` | 19 |

Inputs are read from `private_inputs/selfies/` and results are written to `recon/gate/`; both folders are gitignored, as are the upload copies and renders under `private_inputs/`. A run refuses to start if its results file already exists, so no run can overwrite an earlier one. `scripts/publish_results.py` writes the sanitized copy that goes into `docs/gates/`.

## Privacy
- Only metadata-free sRGB copies are uploaded. The copy is rebuilt from pixels, so no EXIF, GPS or ICC data survives. For Makeup VTO (K1, K1b) the copies are also resized to fit width < 1920 and height < 1080.
- Selfies, upload copies and renders never enter the repository.
- Published JSON has no file ids, task ids, URLs, local paths or original photo sizes; `tests/test_published_results.py` checks this on every test run.

## Limits
One person, one lighting condition, and only the colour and texture of a cheek patch. The render tests are about the renderer, not about any sunscreen. Gate 1 uses one study's data (13 volunteers, 6 formulations).

## License
Code: MIT (see `LICENSE`). The MediaPipe face landmarker model is Apache-2.0 and is downloaded at test time, not stored here. The Gate 1 study data is downloaded from Mendeley Data by `analysis/gate1/fetch_data.py` and is not redistributed.

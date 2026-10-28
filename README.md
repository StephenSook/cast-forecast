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

## Web app
The Cast Forecast site lives in `web/` (Next.js). The UI uses a design system adapted from my HackGT 13 project Lullabuy, with its contrast and overflow defects fixed. Run these from `web/`:

```
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm e2e
```

Try-on routes answer "paused" until the server holds a YouCam key; `/evidence` works without one. CI also runs `pnpm lint`, `pnpm typecheck`, `pnpm build` and `pnpm test:bundle`, which scans the built client JavaScript for key names and the YouCam host.

## Deploy
Deploys run from this Mac with the Vercel CLI (project `cast-forecast-web`, scope `ssookra-7703s-projects`). There is no deploy token, no deploy job in CI and no Git integration, so a push never deploys. Vercel Git integration: none (checked 2026-10-28, CLI).

- `web/scripts/deploy-preview.sh` deploys a preview of a pushed commit. Previews never hold a YouCam key.
- `web/scripts/deploy-prod.sh [--paused]` deploys production, and only when HEAD is `origin/main`. Both scripts refuse unless the linked project is `cast-forecast-web`, the tree is clean, no ignored file would ship, the commit's `test` and `web` CI check-runs are both green (two found, none missing), and `SCAN_ENABLED` is set neither in the target Vercel environment nor in the shell. After a deploy they check the served release SHA, `/api/health`, `/evidence` and `/api/gates`.
- `PROD_URL` defaults to `https://cast-forecast-web.vercel.app`, the alias assumed until the first production deploy confirms it.
- `DRY_RUN=1 bash web/scripts/deploy-prod.sh` runs every gate and deploys nothing.
- Exit codes of `deploy-prod.sh`: 0 ok; 1 refused, or a release failure after the deploy (follow Rollback below); 2 bad arguments; 3 the production alias does not point at the new deployment. Exit 3 is an alias mismatch or a rollback in effect, never a rollback trigger.
- `web/.vercel/deploy-log.txt` is a local, gitignored log: the SHA production served before each deploy, then the deployment URL, SHA and mode (`live` or `paused`).

Below, `$S` is `--scope ssookra-7703s-projects` and `release` means `python3 -I web/scripts/deploy_checks.py release`.

Rollback, only when `deploy-prod.sh` exits 1 at the release check:
1. The previous SHA is the one in the `serving` line that run printed (also the newest `serving` line in the deploy log). If it says `serving none` and the log has no earlier `deployment` line, this was the first production deploy: nothing to roll back to, so pause instead.
2. `pnpm dlx vercel@62.1.0 rollback $S`, then `release "$PROD" <previous SHA>` must exit 0 (add `--allow-no-youcam` when the log's `deployment` line for that SHA says `mode paused`).
3. After a rollback Vercel stops assigning the production domain to new deployments, so the next `deploy-prod.sh` exits 3. Post-rollback path for the next good deploy: run `deploy-prod.sh` (exit 3 expected); `release <deployment url> <SHA>` with the URL and SHA that run printed must exit 0; then `pnpm dlx vercel@62.1.0 promote <that url> $S`; then `release "$PROD" <SHA>` must exit 0. If the deployment URL answers 401, check it in a logged-in browser before promoting.

Pause try-on (credits draining, a YouCam incident, or any judge-facing failure):
1. `pnpm dlx vercel@62.1.0 env rm YOUCAM_API_KEY production --yes $S`.
2. `bash web/scripts/deploy-prod.sh --paused`. Env changes apply only to new deployments. Expect exit 0 with `youcam=false`, `/api/credits` answering 503 `not_configured` and `/evidence` answering 200. If it exits 3 because a rollback is in effect, use the post-rollback path with `--allow-no-youcam` on both release checks.
3. To resume, re-add the key with `vercel env add YOUCAM_API_KEY production --sensitive`, then run `bash web/scripts/deploy-prod.sh`.

If `pnpm dlx` stops with `ERR_PNPM_IGNORED_BUILDS` for esbuild, the scripts already pass `--allow-build=esbuild`; use the same flag for the manual commands above.

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

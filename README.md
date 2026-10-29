# Cast Forecast

See a mineral sunscreen's white cast on your own selfie before you buy it.

**Try it:** https://cast-forecast-web.vercel.app · **Evidence:** https://cast-forecast-web.vercel.app/evidence

## How it works
1. Take a selfie or upload one.
2. Pick the swatch closest to your skin, or tap **Suggest my tone**: YouCam's AI Fitzpatrick Skin Type Analysis reads the selfie and picks one. You can change it.
3. Tap a bottle. YouCam Makeup VTO renders that bottle's predicted cast on your face. Drag the slider to compare before and after.

## Where each number comes from
- **The bottle:** its zinc oxide percentage, read from its FDA label on DailyMed. Eight zinc-only sunscreens, each pinned by label set id in [`data/bottles/fda_labels.json`](data/bottles/fda_labels.json). A label is used only when its listed active ingredient is exactly zinc oxide and its text gives one plain percentage.
- **The prediction:** the PLOS ONE 2025 study's own label score, `dL* = (a + c × ZnO%) × (100 − L* before)`, fitted on the study's raw data. In a strict held-out test (Gate 1) it missed by 1.61 L* on average (1.80 on the study's darker skin tones). Each result shows a ±2.35 L* band, the test's error on the study's one differently formulated product, because retail bottles are formulated differently too. CI recomputes the 1.61 from the committed table, [`data/plos2025/cells.csv`](data/plos2025/cells.csv).
- **The picture:** a white foundation layer at the whole colorIntensity whose shown lightening, on the K1b curve, comes closest to the prediction (all 40 bottle and tone renders within 0.16 L*).

## YouCam APIs
| API | Category | Used for |
|---|---|---|
| File upload | | every request below |
| Makeup VTO (foundation) | Beauty | the render |
| AI Fitzpatrick Skin Type Analysis | Skin | Suggest my tone |
| AI Skin Tone Analysis | Skin | tested in Gate K2, which it failed as a colour measurement; not used by the app |

## What it does not do
- Nothing here was measured on a bottle in person. Gate 2 (cards and a forearm) was written down and never run, so every number is a prediction from the label.
- Skin deeper than the study measured (L* below 44) gets no prediction, and the app says so.
- It shows appearance only. It says nothing about sun protection.

## Gates
Each gate has a pass rule written before its data existed, and every result stays published.

- Gate 1: FAIL for the film model; the label score above won and is what the app uses.
- K2: FAIL. YouCam's skin tone value is repeatable but does not track the photo's colour (15.1 dE00 from the measured cheek), so the shopper picks a tone instead.
- K1: FAIL on 4 of 5 criteria, with coverage as the dose.
- K1b: PASS 5 of 5, with colorIntensity as the dose. This curve maps each prediction to a render.
- Gate 2: not run.

Rules, results and timing: [docs/gates/README.md](docs/gates/README.md).

## For developers

### Run the tests (no API key needed)
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

### Web app
The Cast Forecast site lives in `web/` (Next.js). The UI uses a design system adapted from my HackGT 13 project Lullabuy, with its contrast and overflow defects fixed. Run these from `web/`:

```
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
pnpm e2e
```

`pnpm e2e` serves the last `pnpm build` with `next start`, so build first. It also runs the deploy release check (`web/scripts/deploy_checks.py`, needs `python3`) against that server; if you build with `NEXT_PUBLIC_RELEASE_SHA` set, run `pnpm e2e` with the same value.

Try-on routes (`/api/upload`, `/api/render`, `/api/skin-type`) answer "paused" until the server holds a YouCam key; `/evidence` works without one. `/api/tone` (a 20-unit skin tone analysis that no page calls) answers 404 unless the server sets `TONE_ENABLED=1`, which is for local runs only: the deploy scripts refuse it, like `SCAN_ENABLED`. CI also runs `pnpm lint`, `pnpm typecheck`, `pnpm build` and `pnpm test:bundle`, which scans the built client JavaScript for key names and the YouCam host.

Privacy (web app): the selfie leaves the browser only when you tap a bottle or Suggest my tone. The server then removes EXIF (GPS included), XMP, IPTC, embedded thumbnails and comments, keeps the colour profile, and sends that copy to YouCam to render. The app stores no photo. Result links are YouCam's and last about 2 hours (the page treats one as expired 5 minutes early), as does the session cookie.

#### Limits
- The credit floor (`CREDIT_FLOOR`, default 100 units) and the per-session and per-IP request limits are per server instance and best effort. Each instance keeps its own cached balance, unit holds and request counts in memory; instances do not share them, and a cold start forgets the counts.
- Near the floor, instances running at the same time can each admit a task on the balance they last read, so the account can end up below the floor by about one task per instance (1 unit for a render, 10 for a skin-type read, 20 for a tone analysis).
- The YouCam account balance is the hard stop: with too few units YouCam refuses the task (`CreditInsufficiency`, answered as `credits_low`).

### Deploy
Deploys run from this Mac with the Vercel CLI (project `cast-forecast-web`, scope `ssookra-7703s-projects`). There is no deploy token, no deploy job in CI and no Git integration, so a push never deploys. Vercel Git integration: none (checked 2026-10-28, CLI).

Vercel environment variables, exactly these:

| Environment | Variables |
|---|---|
| Production | `YOUCAM_API_KEY` (sensitive), `SESSION_SECRET` (sensitive, 32+ characters), `CREDIT_FLOOR=100`, `ENABLE_EXPERIMENTAL_COREPACK=1` |
| Preview | `SESSION_SECRET` (sensitive, 32+ characters), `ENABLE_EXPERIMENTAL_COREPACK=1` |
| Never | `SCAN_ENABLED`, `TONE_ENABLED` or `SITE_URL` in any environment, and no YouCam key on preview |

`NEXT_PUBLIC_RELEASE_SHA` is not stored in Vercel: the deploy scripts pass it on each deploy with `--build-env`.

- `web/scripts/deploy-preview.sh` deploys a preview of a pushed commit. Previews never hold a YouCam key: the script refuses before deploying when the preview environment lists `YOUCAM_API_KEY` at all (the name alone fails, and a listing that fails is a refusal), and its release check needs `/api/health` to answer `youcam` exactly `false`. Its build log is kept in `web/.vercel/preview-build.log`. It deploys with `--target preview` and reads the JSON Vercel prints: if Vercel still reports a production deployment it stops with exit 1 and says production has changed (an untargeted deploy of this new project went to production on 2026-10-28). Previews sit behind Vercel Authentication, which answers a signed-out client with a redirect to the Vercel login (or a 401), so the script usually exits 4 and says so: open the preview in a logged-in browser to check it (a rerun of the release check would be blocked the same way). On any other exit 4 (unreachable from this Mac, redirected elsewhere, or a checker error), rerun the release check by hand.
- `web/scripts/deploy-prod.sh [--paused]` deploys production, and only when HEAD is `origin/main` and GitHub's `main` is that same SHA. A live deploy's release check needs `youcam` exactly `true`. A `--paused` deploy holds no key: it refuses before deploying while the production environment still lists `YOUCAM_API_KEY`, and its release check needs `youcam` exactly `false`.
- Both scripts refuse unless `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are unset (they override the link), the linked project is `cast-forecast-web`, the tree is clean (untracked files included, whatever `status.showUntrackedFiles` says), no ignored file would ship, the commit's `test` and `web` CI check-runs are both green (two found, none missing), and neither `SCAN_ENABLED` nor `TONE_ENABLED` is set in the target Vercel environment (the name alone fails, whatever its value) or in the shell (anything but empty or `0`). After a deploy they check the served release SHA, `/api/health`, `/evidence` and `/api/gates`.
- `PROD_URL` defaults to `https://cast-forecast-web.vercel.app`, the production alias, confirmed by the first production deploy on 2026-10-28 (release c518047).
- `DRY_RUN=1 bash web/scripts/deploy-prod.sh` runs every gate and deploys nothing. Any value other than empty or `0` is a dry run.
- `web/.vercel/deploy-log.txt` is a local, gitignored log: the SHA production served before each deploy, then the deployment URL, SHA and mode (`live` or `paused`).

Exit codes of `deploy-prod.sh`:

| Code | Meaning | Roll back? |
|---|---|---|
| 0 | Deployed and the release check passed | no |
| 1 | Refused before deploying (any gate, including a failed `git rev-parse`, or `--paused` while production lists `YOUCAM_API_KEY`), or the release check read a response that did not match after the deploy (including a `--paused` deploy whose health reports `youcam` true) | only for the release-check failure ("Deployed, but the release check failed") |
| 2 | Bad arguments | no |
| 3 | The production alias does not point at the new deployment: an alias mismatch or a rollback in effect | never |
| 4 | Deployed or maybe deployed but unverified (deploy exited non-zero, odd output, no production target reported, inspect failed), or the release check verified nothing: the site was unreachable from this Mac on the last attempt (network, DNS, proxy), a page redirected, the checker raised, or Vercel Authentication blocked it (a 401 or a redirect to its login) | no: read the printed `serving` line, fix the network or the protection setting, then run the release check by hand |

Below, `$S` is `--scope ssookra-7703s-projects`, `vc` is `pnpm dlx --allow-build=esbuild vercel@62.1.0`, and `release` means `python3 -I web/scripts/deploy_checks.py release`. `release` never follows a redirect. It exits 1 only when it read a response that did not match, and 4 when it verified nothing (Vercel Authentication, any redirect, the site unreachable on the last attempt, or a checker error). `release <url> <SHA>` needs `youcam` true; `release <url> <SHA> --require-no-youcam` needs `youcam` false and fails at once on an active key (it replaces the old `--allow-no-youcam`, which only relaxed the check and is now refused as an unknown option).

Rollback, only when `deploy-prod.sh` exits 1 at the release check:
1. The previous SHA is the one in the `serving` line that run printed (also the newest `serving` line in the deploy log). If it says `serving none` and the log has no earlier `deployment` line, this was the first production deploy: nothing to roll back to, so pause instead.
2. `vc rollback $S`, then `release "$PROD" <previous SHA>` must exit 0 (add `--require-no-youcam` when the log's `deployment` line for that SHA says `mode paused`).
3. After a rollback Vercel stops assigning the production domain to new deployments, so the next `deploy-prod.sh` exits 3. Post-rollback path for the next good deploy: run `deploy-prod.sh` (exit 3 expected); `release <deployment url> <SHA>` with the URL and SHA that run printed must exit 0; then `vc promote <that url> $S`; then `release "$PROD" <SHA>` must exit 0. If Vercel Authentication blocks the deployment URL, check it in a logged-in browser before promoting.

Pause try-on (credits draining, a YouCam incident, or any judge-facing failure):
1. `vc env rm YOUCAM_API_KEY production --yes $S`.
2. `bash web/scripts/deploy-prod.sh --paused`. It refuses (exit 1, nothing deployed) while step 1 has not removed the key. Env changes apply only to new deployments. Expect exit 0 with `youcam=false`, `/api/credits` answering 503 `not_configured` and `/evidence` answering 200. If it exits 3 because a rollback is in effect, use the post-rollback path with `--require-no-youcam` on both release checks.
3. To resume, re-add the key with `vc env add YOUCAM_API_KEY production --sensitive $S`, then run `bash web/scripts/deploy-prod.sh`.

Owner setup in the Vercel dashboard (not scripted): set Deployment Protection so it covers previews only, so the production `*.vercel.app` alias is public; set the project's Node.js version to 22.x so it agrees with `engines` in `web/package.json`.

Re-linking: `web/.gitignore` already holds `.vercel` and `.env*.local`, so `vercel link` does not create or change any tracked file. It does write `web/.env.local` (a Vercel OIDC token). That file is gitignored and listed in `.vercelignore`, is never committed, and should be deleted after linking. Link once; the deploy scripts never link.

### Live runs
These spend YouCam API units and need the key in the macOS Keychain under the service name `youcam-api-key`. Each run checks the balance before uploading anything and stops if it is under 200 units.

| Run | Command | Units |
|---|---|---|
| K2 | `python -m castforecast.k2_tone --selfie A` | 60 |
| K1 | `python -m castforecast.k1_render --selfie A --check B` | 42 |
| K1b | `python -m castforecast.k1b_render --selfie A --check B` | 19 |

Inputs are read from `private_inputs/selfies/` and results are written to `recon/gate/`; both folders are gitignored, as are the upload copies and renders under `private_inputs/`. A run refuses to start if its results file already exists, so no run can overwrite an earlier one. `scripts/publish_results.py` writes the sanitized copy that goes into `docs/gates/`.

The web app's live checks run in a browser against a deployed site and never in CI: a real try-on (1 unit) and a real skin-type read (10 units).

```
cd web
BASE_URL=https://cast-forecast-web.vercel.app LIVE_SELFIE=/path/to/selfie.jpg pnpm e2e:live --project desktop
```

### Privacy (gate harness)
The web app has its own privacy line, under Web app.

- Only metadata-free sRGB copies are uploaded. The copy is rebuilt from pixels, so no EXIF, GPS or ICC data survives. For Makeup VTO (K1, K1b) the copies are also resized to fit width < 1920 and height < 1080.
- Selfies, upload copies and renders never enter the repository.
- Published JSON has no file ids, task ids, URLs, local paths or original photo sizes; `tests/test_published_results.py` checks this on every test run.

### Limits (gate harness)
One person, one lighting condition, and only the colour and texture of a cheek patch. The render tests are about the renderer, not about any sunscreen. Gate 1 uses one study's data (13 volunteers, 6 formulations).

### License
Code: MIT (see `LICENSE`). The MediaPipe face landmarker model is Apache-2.0 and is downloaded at test time, not stored here. The Gate 1 study's spreadsheets are downloaded from Mendeley Data by `analysis/gate1/fetch_data.py` and are not redistributed; the derived table `data/plos2025/cells.csv` is committed under the study data's CC BY 4.0 license, credited in [`data/plos2025/README.md`](data/plos2025/README.md).

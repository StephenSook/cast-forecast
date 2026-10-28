#!/usr/bin/env bash
# Production deploy from this Mac. Usage: deploy-prod.sh [--paused]
# DRY_RUN=<anything but empty or 0> stops after the gates.
# Exit codes: 0 ok. 1 refused before deploying, or the release check read a mismatched response
# after it (rollback steps in the README). 2 bad arguments. 3 the production alias does not point
# at the new deployment (never a rollback trigger). 4 deployed or maybe deployed but UNVERIFIED:
# the deploy step failed oddly or did not report a production target, the release check could not
# reach the site, was redirected or hit a checker error, or Vercel Authentication blocked it (a 401
# or a redirect to its login). Never roll back on 4.
# Every gate is bare: no pipe on any exit path.
set -euo pipefail

PAUSED=0
for arg in "$@"; do
  case "$arg" in
    --paused) PAUSED=1 ;;
    *) echo "unknown argument: $arg"; exit 2 ;;
  esac
done

# These two variables override .vercel/project.json, which would bypass the link gate.
if [ -n "${VERCEL_ORG_ID:-}" ] || [ -n "${VERCEL_PROJECT_ID:-}" ]; then
  echo "VERCEL_ORG_ID / VERCEL_PROJECT_ID are set; they override the link gate. Unset them."
  exit 1
fi

V="pnpm dlx --allow-build=esbuild vercel@62.1.0"
SCOPE="ssookra-7703s-projects"
PROD="${PROD_URL:-https://cast-forecast-web.vercel.app}"
PROD="${PROD%/}"
ALIAS="${PROD#https://}"
ALIAS="${ALIAS#http://}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
LOG=.vercel/deploy-log.txt
tmp=$(mktemp)
trap 'rm -f "$tmp" "$tmp".*' EXIT

fail() { echo "$1"; exit 1; }

# After the deploy command has run, production may already have changed. Never exit 1 (the
# rollback trigger) from here on unless the release check itself proved a bad release.
unverified() {
  echo "$1"
  echo "Deployed or maybe deployed, UNVERIFIED. Do not roll back blindly: read what production serves now:"
  python3 -I scripts/deploy_checks.py serving "$PROD" || true
  echo "Then run the release check by hand (README, deploy section)."
  exit 4
}

# 1. linked project, fresh origin/main, clean tree, nothing ignored that would ship. Untracked
# files are requested explicitly: a local status.showUntrackedFiles=no must not hide a file that
# would upload.
if ! python3 -I scripts/deploy_checks.py link .vercel/project.json; then
  fail "Not linked to cast-forecast-web. Run the link step; never deploy from an unlinked directory."
fi
if ! git fetch origin main; then fail "git fetch origin main failed"; fi
if ! git status --porcelain --untracked-files=normal > "$tmp.st"; then fail "git status failed"; fi
if [ -s "$tmp.st" ]; then fail "Working tree is not clean. Commit or stash first."; fi
if ! git status --porcelain --untracked-files=normal --ignored -- . > "$tmp.ign"; then
  fail "git status --ignored failed"
fi
if ! grep -F -x -q '!! web/.vercel/' "$tmp.ign"; then
  fail "The ignored listing does not show web/.vercel/, so it cannot be trusted."
fi
if ! python3 -I scripts/deploy_checks.py ignored "$tmp.ign"; then fail "Ignored files would ship."; fi

# 2. branch: production ships origin/main and nothing else, and GitHub agrees
SHA=$(git rev-parse HEAD) || fail "git rev-parse HEAD failed"
MAIN=$(git rev-parse origin/main) || fail "git rev-parse origin/main failed"
if [ "$SHA" != "$MAIN" ]; then fail "HEAD is not origin/main"; fi
if ! gh api "repos/StephenSook/cast-forecast/commits/main" --jq .sha > "$tmp.main"; then
  fail "Could not read the SHA of main from GitHub."
fi
GH_MAIN=$(cat "$tmp.main")
if [ "$GH_MAIN" != "$SHA" ]; then fail "GitHub main is $GH_MAIN, not $SHA."; fi

# 3. CI
if ! gh api "repos/StephenSook/cast-forecast/commits/$SHA/check-runs?per_page=100" > "$tmp"; then
  fail "Could not read the check-runs for $SHA."
fi
if ! python3 -I scripts/deploy_checks.py ci "$tmp" 2; then fail "CI is not green for $SHA."; fi

# 3b. the scan and tone flags must not exist in the production environment or this shell
if ! $V env ls production --scope "$SCOPE" > "$tmp.env" 2>&1; then
  fail "Could not list production environment variables."
fi
if ! python3 -I scripts/deploy_checks.py scan "$tmp.env"; then
  fail "SCAN_ENABLED and TONE_ENABLED must not be set."
fi

# 3c. a paused deploy holds no YouCam key: refuse while production still lists one (presence alone
# fails, and a failed listing already failed above)
if [ "$PAUSED" = "1" ]; then
  if ! python3 -I scripts/deploy_checks.py nokey "$tmp.env"; then
    fail "YOUCAM_API_KEY is still set in production. Remove it first (README, pause steps)."
  fi
fi

# 4. dry run: any value but empty or 0 stops here
case "${DRY_RUN:-}" in
  ""|0) ;;
  *) echo "DRY_RUN=${DRY_RUN}: gates passed, nothing deployed"; exit 0 ;;
esac

# 5. record what production serves before this deploy
mkdir -p .vercel
if ! python3 -I scripts/deploy_checks.py serving "$PROD" > "$tmp.serving"; then
  fail "Could not record the currently served release."
fi
SERVING=$(cat "$tmp.serving")
echo "$SERVING"
echo "$(date -u +%FT%TZ) $SERVING before $SHA" >> "$LOG"

# 6. deploy (from here on, failures are exit 4, never 1)
# The JSON output names the deployment's target; only a production target counts. --non-interactive
# gives the output the same shape from a terminal as from an agent.
if ! $V deploy --prod --format json --non-interactive --yes --scope "$SCOPE" \
  --build-env "NEXT_PUBLIC_RELEASE_SHA=$SHA" > "$tmp.url"; then
  unverified "vercel deploy exited non-zero."
fi
URL=$(python3 -I scripts/deploy_checks.py deployed "$tmp.url" production) ||
  unverified "Unexpected deploy output: $URL"
MODE=live
if [ "$PAUSED" = "1" ]; then MODE=paused; fi
echo "deployment: $URL"
# The deploy has happened: a log that cannot be written is a warning, never the rollback exit 1.
LINE="deployment $URL sha $SHA mode $MODE"
if ! echo "$(date -u +%FT%TZ) $LINE" >> "$LOG"; then
  echo "warning: could not write $LOG: $LINE. Not a release failure; the deploy goes on (keep this line)."
fi

# 7. the production alias must point at this deployment
if ! $V inspect "$URL" --scope "$SCOPE" > "$tmp.inspect" 2>&1; then
  cat "$tmp.inspect"
  unverified "Could not inspect $URL."
fi
cat "$tmp.inspect"
# Whole tokens only: one token per line with the scheme and trailing slashes removed, so a longer
# alias that merely contains $ALIAS (old-cast-forecast-web.vercel.app) does not match.
if ! tr -s '[:space:]' '\n' < "$tmp.inspect" > "$tmp.words"; then
  unverified "Could not split the inspect output."
fi
if ! sed -E -e 's#^https?://##' -e 's#/+$##' "$tmp.words" > "$tmp.aliases"; then
  unverified "Could not read the aliases from the inspect output."
fi
rc=0
grep -F -x -q -- "$ALIAS" "$tmp.aliases" || rc=$?
if [ "$rc" = "1" ]; then
  echo "$PROD is not an alias of $URL. Not a release failure: do not roll back. See README (deploy section): alias mismatch or post-rollback path."
  exit 3
fi
if [ "$rc" != "0" ]; then unverified "grep failed while reading the inspect output."; fi

# 8. the release check: a live deploy needs youcam=true, a paused one youcam=false exactly
FLAG=""
if [ "$PAUSED" = "1" ]; then FLAG="--require-no-youcam"; fi
rc=0
python3 -I scripts/deploy_checks.py release "$PROD" "$SHA" $FLAG > "$tmp.release" || rc=$?
cat "$tmp.release"
if [ "$rc" = "0" ]; then exit 0; fi
# Only exit 1 from the checker is a verified bad release. 4 (or anything unexpected) verified nothing.
if [ "$rc" != "1" ]; then
  auth=0
  grep -F -q "behind Vercel Authentication" "$tmp.release" || auth=$?
  if [ "$auth" = "0" ]; then
    echo "Vercel Authentication blocks $PROD (a 401 or a redirect to the Vercel login). This is a protection setting, not a release failure: do not roll back. Set Deployment Protection to previews only in the Vercel dashboard, then run the release check by hand (README, deploy section)."
  else
    echo "The release check could not verify $PROD (unreachable from this Mac, redirected, or a checker error). This is not a release failure: do not roll back. Fix that, then run the release check by hand (README, deploy section)."
  fi
  exit 4
fi
echo "Deployed, but the release check failed. Follow the rollback steps in README (deploy section)."
exit 1

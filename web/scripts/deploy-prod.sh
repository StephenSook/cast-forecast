#!/usr/bin/env bash
# Production deploy from this Mac. Usage: deploy-prod.sh [--paused]   (DRY_RUN=1 stops after the gates)
# Exit codes: 0 ok, 1 refused or release failure, 2 bad arguments, 3 alias mismatch (not a rollback
# trigger). Every gate is bare: no pipe on any exit path.
set -euo pipefail

PAUSED=0
for arg in "$@"; do
  case "$arg" in
    --paused) PAUSED=1 ;;
    *) echo "unknown argument: $arg"; exit 2 ;;
  esac
done

V="${VERCEL_CMD:-pnpm dlx --allow-build=esbuild vercel@62.1.0}"
SCOPE="ssookra-7703s-projects"
PROD="${PROD_URL:-https://cast-forecast-web.vercel.app}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
LOG=.vercel/deploy-log.txt
tmp=$(mktemp)
trap 'rm -f "$tmp" "$tmp".*' EXIT

fail() { echo "$1"; exit 1; }

# 1. linked project, fresh origin/main, clean tree, nothing ignored that would ship
if ! python3 -I scripts/deploy_checks.py link .vercel/project.json; then
  fail "Not linked to cast-forecast-web. Run the link step; never deploy from an unlinked directory."
fi
if ! git fetch origin main; then fail "git fetch origin main failed"; fi
if ! git status --porcelain > "$tmp.st"; then fail "git status failed"; fi
if [ -s "$tmp.st" ]; then fail "Working tree is not clean. Commit or stash first."; fi
if ! git status --porcelain --ignored -- . > "$tmp.ign"; then fail "git status --ignored failed"; fi
if ! python3 -I scripts/deploy_checks.py ignored "$tmp.ign"; then fail "Ignored files would ship."; fi

# 2. branch: production ships origin/main and nothing else
SHA=$(git rev-parse HEAD)
MAIN=$(git rev-parse origin/main)
if [ "$SHA" != "$MAIN" ]; then fail "HEAD is not origin/main"; fi

# 3. CI
if ! gh api "repos/StephenSook/cast-forecast/commits/$SHA/check-runs?per_page=100" > "$tmp"; then
  fail "Could not read the check-runs for $SHA."
fi
if ! python3 -I scripts/deploy_checks.py ci "$tmp" 2; then fail "CI is not green for $SHA."; fi

# 3b. the scan flag must not exist in the production environment or this shell
if ! $V env ls production --scope "$SCOPE" > "$tmp.env" 2>&1; then
  fail "Could not list production environment variables."
fi
if ! python3 -I scripts/deploy_checks.py scan "$tmp.env"; then fail "SCAN_ENABLED must not be set."; fi

# 4. dry run
if [ "${DRY_RUN:-}" = "1" ]; then
  echo "DRY_RUN=1: gates passed, nothing deployed"
  exit 0
fi

# 5. record what production serves before this deploy
mkdir -p .vercel
if ! python3 -I scripts/deploy_checks.py serving "$PROD" > "$tmp.serving"; then
  fail "Could not record the currently served release."
fi
SERVING=$(cat "$tmp.serving")
echo "$SERVING"
echo "$(date -u +%FT%TZ) $SERVING before $SHA" >> "$LOG"

# 6. deploy
if ! $V deploy --prod --yes --scope "$SCOPE" --build-env "NEXT_PUBLIC_RELEASE_SHA=$SHA" > "$tmp.url"; then
  fail "vercel deploy failed. Nothing was verified."
fi
URL=$(tail -n 1 "$tmp.url")
case "$URL" in https://*) ;; *) fail "Unexpected deploy output: $URL" ;; esac
MODE=live
if [ "$PAUSED" = "1" ]; then MODE=paused; fi
echo "deployment: $URL"
echo "$(date -u +%FT%TZ) deployment $URL sha $SHA mode $MODE" >> "$LOG"

# 7. the production alias must point at this deployment
if ! $V inspect "$URL" --scope "$SCOPE" > "$tmp.inspect" 2>&1; then
  cat "$tmp.inspect"
  fail "Could not inspect $URL."
fi
cat "$tmp.inspect"
rc=0
grep -F -q "${PROD#https://}" "$tmp.inspect" || rc=$?
if [ "$rc" = "1" ]; then
  echo "$PROD is not an alias of $URL. Not a release failure: do not roll back. See README (deploy section): alias mismatch or post-rollback path."
  exit 3
fi
if [ "$rc" != "0" ]; then fail "grep failed while reading the inspect output."; fi

# 8. the release check
FLAG=""
if [ "$PAUSED" = "1" ]; then FLAG="--allow-no-youcam"; fi
if ! python3 -I scripts/deploy_checks.py release "$PROD" "$SHA" $FLAG; then
  echo "Deployed, but the release check failed. Follow the rollback steps in README (deploy section)."
  exit 1
fi

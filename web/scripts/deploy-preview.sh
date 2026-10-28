#!/usr/bin/env bash
# Preview deploy from this Mac. Previews never get a YouCam key. Every gate is bare: no pipe on
# any exit path, and every failure exits non-zero before anything is uploaded.
set -euo pipefail

V="${VERCEL_CMD:-pnpm dlx --allow-build=esbuild vercel@62.1.0}"
SCOPE="ssookra-7703s-projects"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
tmp=$(mktemp)
trap 'rm -f "$tmp" "$tmp".*' EXIT

fail() { echo "$1"; exit 1; }

# 1. linked project, clean tree, nothing ignored that would ship
if ! python3 -I scripts/deploy_checks.py link .vercel/project.json; then
  fail "Not linked to cast-forecast-web. Run the link step; never deploy from an unlinked directory."
fi
if ! git status --porcelain > "$tmp.st"; then fail "git status failed"; fi
if [ -s "$tmp.st" ]; then fail "Working tree is not clean. Commit or stash first."; fi
if ! git status --porcelain --ignored -- . > "$tmp.ign"; then fail "git status --ignored failed"; fi
if ! python3 -I scripts/deploy_checks.py ignored "$tmp.ign"; then fail "Ignored files would ship."; fi

# 2. HEAD must be pushed, so its check-runs exist
if ! git fetch origin; then fail "git fetch failed"; fi
SHA=$(git rev-parse HEAD)
UPSTREAM=$(git rev-parse '@{u}')
if [ "$SHA" != "$UPSTREAM" ]; then fail "HEAD is not pushed to its upstream branch."; fi

# 3. CI
if ! gh api "repos/StephenSook/cast-forecast/commits/$SHA/check-runs?per_page=100" > "$tmp"; then
  fail "Could not read the check-runs for $SHA."
fi
if ! python3 -I scripts/deploy_checks.py ci "$tmp" 2; then fail "CI is not green for $SHA."; fi

# 3b. the scan flag must not exist in the preview environment or this shell
if ! $V env ls preview --scope "$SCOPE" > "$tmp.env" 2>&1; then
  fail "Could not list preview environment variables."
fi
if ! python3 -I scripts/deploy_checks.py scan "$tmp.env"; then fail "SCAN_ENABLED must not be set."; fi

# 4. deploy
if ! $V deploy --yes --scope "$SCOPE" --build-env "NEXT_PUBLIC_RELEASE_SHA=$SHA" > "$tmp.url"; then
  fail "vercel deploy failed."
fi
URL=$(tail -n 1 "$tmp.url")
case "$URL" in https://*) ;; *) fail "Unexpected deploy output: $URL" ;; esac
echo "deployment: $URL"

# 5. build log (display only, not a gate)
if $V inspect "$URL" --logs --scope "$SCOPE" > "$tmp.log" 2>&1; then :; else echo "inspect --logs failed"; fi
grep -i -E "node|pnpm" "$tmp.log" || true
echo "full build log: $tmp.log (removed on exit)"

# 6. the release check, the last line printed
python3 -I scripts/deploy_checks.py release "$URL" "$SHA" --allow-no-youcam

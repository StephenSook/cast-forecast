#!/usr/bin/env bash
# Preview deploy from this Mac. Previews never get a YouCam key: the script refuses when the preview
# environment lists YOUCAM_API_KEY, and the release check needs /api/health youcam=false exactly.
# Every gate is bare: no pipe on any exit path, and every failure exits non-zero before anything is
# uploaded.
# Exit codes: 0 ok, 1 refused or a verified release failure (the check read a mismatched response),
# 4 UNVERIFIED: the release check could not reach the preview, hit a checker error, or was blocked
# by Vercel Authentication. A preview is never rolled back; on 4, rerun the release check by hand.
set -euo pipefail

# These two variables override .vercel/project.json, which would bypass the link gate.
if [ -n "${VERCEL_ORG_ID:-}" ] || [ -n "${VERCEL_PROJECT_ID:-}" ]; then
  echo "VERCEL_ORG_ID / VERCEL_PROJECT_ID are set; they override the link gate. Unset them."
  exit 1
fi

V="pnpm dlx --allow-build=esbuild vercel@62.1.0"
SCOPE="ssookra-7703s-projects"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
tmp=$(mktemp)
trap 'rm -f "$tmp" "$tmp".*' EXIT

fail() { echo "$1"; exit 1; }

# 1. linked project, clean tree, nothing ignored that would ship. Untracked files are requested
# explicitly: a local status.showUntrackedFiles=no must not hide a file that would upload.
if ! python3 -I scripts/deploy_checks.py link .vercel/project.json; then
  fail "Not linked to cast-forecast-web. Run the link step; never deploy from an unlinked directory."
fi
if ! git status --porcelain --untracked-files=normal > "$tmp.st"; then fail "git status failed"; fi
if [ -s "$tmp.st" ]; then fail "Working tree is not clean. Commit or stash first."; fi
if ! git status --porcelain --untracked-files=normal --ignored -- . > "$tmp.ign"; then
  fail "git status --ignored failed"
fi
if ! grep -F -x -q '!! web/.vercel/' "$tmp.ign"; then
  fail "The ignored listing does not show web/.vercel/, so it cannot be trusted."
fi
if ! python3 -I scripts/deploy_checks.py ignored "$tmp.ign"; then fail "Ignored files would ship."; fi

# 2. HEAD must be pushed, so its check-runs exist
if ! git fetch origin; then fail "git fetch failed"; fi
SHA=$(git rev-parse HEAD) || fail "git rev-parse HEAD failed"
UPSTREAM=$(git rev-parse '@{u}') || fail "This branch has no upstream."
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

# 3c. previews hold no YouCam key: the name alone in the preview listing refuses the deploy
if ! python3 -I scripts/deploy_checks.py nokey "$tmp.env"; then
  fail "YOUCAM_API_KEY must not be set for previews. Remove it from the preview environment."
fi

# 4. dry run: any value but empty or 0 stops here
case "${DRY_RUN:-}" in
  ""|0) ;;
  *) echo "DRY_RUN=${DRY_RUN}: gates passed, nothing deployed"; exit 0 ;;
esac

# 5. deploy
if ! $V deploy --yes --scope "$SCOPE" --build-env "NEXT_PUBLIC_RELEASE_SHA=$SHA" > "$tmp.url"; then
  fail "vercel deploy failed."
fi
URL=$(tail -n 1 "$tmp.url")
# http://127.0.0.1 is accepted only so the test suite can point this script at a local fixture.
case "$URL" in https://*|http://127.0.0.1:*) ;; *) fail "Unexpected deploy output: $URL" ;; esac
echo "deployment: $URL"

# 6. build log, kept under .vercel/ (gitignored); display only, not a gate
mkdir -p .vercel
BUILD_LOG=.vercel/preview-build.log
if $V inspect "$URL" --logs --scope "$SCOPE" > "$BUILD_LOG" 2>&1; then :; else echo "inspect --logs failed"; fi
grep -i -E "node|pnpm" "$BUILD_LOG" || true
echo "full build log: $BUILD_LOG"

# 7. the release check, the last line printed: exit 1 only for a verified mismatch, 4 when nothing
# was verified (unreachable, a checker error, or a 401); health must say youcam=false, so a preview
# that holds an active key fails
python3 -I scripts/deploy_checks.py release "$URL" "$SHA" --require-no-youcam

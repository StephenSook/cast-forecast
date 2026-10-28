"""Deploy gates for the Cast Forecast web app. Stdlib only, so the Mac needs nothing installed.

The two deploy scripts call this file for every verdict that needs real parsing: the linked Vercel
project, the CI check-runs for a SHA, what git would ship from ignored files, the SCAN_ENABLED and
TONE_ENABLED flags, the absence of the YouCam key where a deploy must have none, and the live
release check after a deploy. Every check fails closed: an empty, missing or unparseable input is
a failure, never a pass.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from html.parser import HTMLParser

PROJECT_NAME = "cast-forecast-web"
SCOPE = "ssookra-7703s-projects"
AUTH_401 = "deployment is behind Vercel Authentication (401)"
PROJECT_ID = "prj_13eXRfxiEveDWgUuyKar6XOzl4Lm"
REQUIRED_JOBS = ("test", "web")
SCAN_FLAG = "SCAN_ENABLED"
TONE_FLAG = "TONE_ENABLED"
OFF_FLAGS = (SCAN_FLAG, TONE_FLAG)
KEY_NAME = "YOUCAM_API_KEY"
KEY_LIVE = "youcam is true on a deploy that must hold no key"
IGNORED_OK = (
    "web/node_modules/",
    "web/.next/",
    "web/.vercel/",
    "web/next-env.d.ts",
    "web/tsconfig.tsbuildinfo",
    "web/playwright-report/",
    "web/test-results/",
)
UNREACHABLE = "unreachable"
ATTEMPTS = 6
ATTEMPTS_ENV = "RELEASE_ATTEMPTS"


def linked_project_ok(project: dict) -> bool:
    return (
        isinstance(project, dict)
        and project.get("projectName") == PROJECT_NAME
        and project.get("projectId") == PROJECT_ID
    )


def ci_verdict(
    check_runs: dict, floor: int, required: tuple[str, ...] = REQUIRED_JOBS
) -> tuple[bool, str]:
    runs = check_runs.get("check_runs") if isinstance(check_runs, dict) else None
    if not isinstance(runs, list):
        runs = []
    runs = [r for r in runs if isinstance(r, dict)]
    gated = [r for r in runs if r.get("name") in required]
    for name in required:
        if not any(r.get("name") == name for r in gated):
            return False, f"missing check-run: {name}"
    if len(gated) < floor:
        return False, f"{len(gated)} gated check-runs, need {floor}"
    for r in gated:
        if r.get("conclusion") != "success":
            return False, f"{r.get('name')} is {r.get('conclusion') or 'pending'}"
    msg = f"ok: {len(gated)} gated check-runs"
    others = [r for r in runs if r.get("name") not in required]
    if others:
        listed = ", ".join(f"{r.get('name')}={r.get('conclusion') or 'pending'}" for r in others)
        msg += f"; not gated: {listed}"
    return True, msg


def served_release(html: str) -> str | None:
    for tag in re.findall(r"<meta\b[^>]*>", html, flags=re.IGNORECASE):
        attrs = dict(re.findall(r'([\w:-]+)\s*=\s*"([^"]*)"', tag))
        if attrs.get("name") == "cf-release":
            return attrs.get("content")
    return None


def release_in_html(html: str, sha: str) -> bool:
    return bool(sha) and served_release(html) == sha


def health_ok(body: dict, sha: str, want_youcam: bool = True) -> tuple[bool, str]:
    """`want_youcam` True (a live production deploy) needs youcam exactly true. False (a preview or
    a paused production deploy) needs youcam exactly false: an active key there is a failure, and
    so is a missing or non-boolean answer."""
    if not isinstance(body, dict):
        return False, "health body is not an object"
    if body.get("release") != sha:
        return False, f"release {body.get('release')}, want {sha}"
    if body.get("session") is not True:
        return False, "session secret not configured"
    youcam = body.get("youcam")
    if want_youcam and youcam is not True:
        return False, "youcam not configured"
    if not want_youcam and youcam is True:
        return False, KEY_LIVE
    if not want_youcam and youcam is not False:
        return False, f"youcam is {json.dumps(youcam)}, want false"
    node = body.get("node")
    if not isinstance(node, str) or not node.startswith("22."):
        return False, f"node {node}, want 22.x"
    return True, "ok"


class _GateRows(HTMLParser):
    """Collects (data-gate, data-verdict) from every element with role="row"."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[tuple[str | None, str | None]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if a.get("role") == "row":
            self.rows.append((a.get("data-gate"), a.get("data-verdict")))


def evidence_ok(html: str) -> bool:
    """True only when /evidence holds a role="row" element with data-gate K1b and data-verdict PASS,
    the attributes web/src/ui/GateTable.tsx puts on each body row. Text alone never counts."""
    parser = _GateRows()
    parser.feed(html)
    parser.close()
    return ("K1b", "PASS") in parser.rows


def gates_ok(body: dict) -> tuple[bool, str]:
    k1b = body.get("k1b") if isinstance(body, dict) else None
    checks = k1b.get("inverseCheck") if isinstance(k1b, dict) else None
    if not isinstance(checks, list) or not checks:
        return False, "no inverse checks"
    for i, c in enumerate(checks, start=1):
        if not isinstance(c, dict) or c.get("match") is not True:
            return False, f"inverse check {i} does not match"
    return True, "ok"


def ignored_ok(porcelain: str) -> tuple[bool, str]:
    count = 0
    for line in porcelain.splitlines():
        if not line.startswith("!! "):
            continue
        path = line[3:]
        last = path.rstrip("/").rsplit("/", 1)[-1]
        allowed = (
            path in IGNORED_OK or last.startswith(".env") or last in (".DS_Store", "__pycache__")
        )
        if not allowed:
            return False, f"ignored path would ship: {path}"
        count += 1
    return True, f"ok: {count} ignored paths, all excluded from the upload"


def _listing_names_project(env_listing: str) -> bool:
    """True only for a `vercel env ls` listing of this project. Empty, an error or another project
    is not a listing, so callers fail on it."""
    named = re.search(rf"{SCOPE}/{PROJECT_NAME}(?=\s|$)", env_listing)
    return bool(named) and "Environment Variable" in env_listing


def _lists_name(env_listing: str, name: str) -> bool:
    return bool(re.search(rf"(?<![\w]){name}(?![\w])", env_listing))


def scan_flag_ok(
    env_listing: str, local_value: str | None, flag: str = SCAN_FLAG
) -> tuple[bool, str]:
    """A flag (SCAN_ENABLED by default) must be unset in the target Vercel environment and in
    this shell.

    `vercel env ls` shows names only (sensitive values are never readable), so the rule is
    stricter than "0 or unset": any variable with the flag's name in the target fails the deploy.
    A listing that does not name this project (empty, an error, the wrong project) is a failure,
    not a pass.
    """
    if not _listing_names_project(env_listing):
        return False, f"environment listing does not name {PROJECT_NAME} (the listing failed)"
    if _lists_name(env_listing, flag):
        return False, f"{flag} is set in the target environment"
    if local_value not in (None, "", "0"):
        return False, f"{flag} is set in this shell"
    return True, f"ok: {flag} is not set"


def flags_ok(env_listing: str, env: Mapping[str, str]) -> tuple[bool, str]:
    """SCAN_ENABLED and TONE_ENABLED, each by the scan_flag_ok rule. TONE_ENABLED opens the paid
    /api/tone that no page calls, so no deploy may carry it."""
    for flag in OFF_FLAGS:
        ok, why = scan_flag_ok(env_listing, env.get(flag), flag)
        if not ok:
            return False, why
    return True, f"ok: {' and '.join(OFF_FLAGS)} are not set"


def key_absent_ok(env_listing: str) -> tuple[bool, str]:
    """For a preview or a paused production deploy: YOUCAM_API_KEY must not exist in the target.

    Values are never readable, so the name alone fails the deploy, whatever it holds. A listing
    that does not name this project (empty, an error, the wrong project) is a failure, not a pass.
    """
    if not _listing_names_project(env_listing):
        return False, f"environment listing does not name {PROJECT_NAME} (the listing failed)"
    if _lists_name(env_listing, KEY_NAME):
        return False, f"{KEY_NAME} is set in the target environment"
    return True, f"ok: {KEY_NAME} is not set"


def _get(url: str) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except (urllib.error.URLError, OSError, ValueError) as e:
        return 0, f"{UNREACHABLE} ({e})"


def _json(body: str):
    try:
        return json.loads(body)
    except ValueError:
        return None


def _attempt(base: str, sha: str, want_youcam: bool) -> tuple[bool, str, str, bool]:
    """One pass over the four pages. Returns (ok, message, health-detail, verified).

    `verified` is False when the pass failed because a page could not be fetched at all (status 0:
    DNS, proxy, network) or answered 401: then nothing is known about the release itself.
    """
    status, body = _get(f"{base}/")
    if status == 401:
        return False, "401", "", False
    if status == 0:
        return False, f"html: {body}", "", False
    if status != 200:
        return False, f"html: status {status}", "", True
    if not release_in_html(body, sha):
        return False, f"html: cf-release is not {sha}", "", True

    status, body = _get(f"{base}/api/health")
    if status == 401:
        return False, "401", "", False
    if status == 0:
        return False, f"health: {body}", "", False
    if status != 200:
        return False, f"health: status {status}", "", True
    health = _json(body)
    ok, why = health_ok(health, sha, want_youcam)
    if not ok:
        return False, f"health: {why}", "", True
    detail = (
        f"health (youcam={str(health.get('youcam') is True).lower()}, session=true, "
        f"node={health['node']})"
    )

    status, body = _get(f"{base}/evidence")
    if status == 401:
        return False, "401", "", False
    if status == 0:
        return False, f"evidence: {body}", "", False
    if status != 200:
        return False, f"evidence: status {status}", "", True
    if not evidence_ok(body):
        return False, "evidence: no K1b PASS row", "", True

    status, body = _get(f"{base}/api/gates")
    if status == 401:
        return False, "401", "", False
    if status == 0:
        return False, f"gates: {body}", "", False
    if status != 200:
        return False, f"gates: status {status}", "", True
    ok, why = gates_ok(_json(body))
    if not ok:
        return False, f"gates: {why}", "", True
    return True, "", detail, True


def release_attempts(raw: str | None) -> int | None:
    """RELEASE_ATTEMPTS, a knob for tests only: unset or empty is the default 6; a whole number
    from 1 to 6 is used as given (it can only shorten the check); anything else is None."""
    if raw is None or raw == "":
        return ATTEMPTS
    if re.fullmatch(r"[1-9][0-9]*", raw) and int(raw) <= ATTEMPTS:
        return int(raw)
    return None


def release_check(
    base: str,
    sha: str,
    want_youcam: bool = True,
    attempts: int = ATTEMPTS,
    sleep: Callable[[float], None] | None = None,
) -> tuple[bool, str, bool]:
    """Returns (ok, message, verified). A failure is verified only when the last attempt read a
    response that mismatched. It is unverified (nothing is known about the release) when the last
    attempt could not fetch a page, Vercel Authentication answered 401, or the checker raised."""
    pause = sleep or time.sleep
    base = base.rstrip("/")
    last, verified = "no attempt ran", False
    for n in range(attempts):
        try:
            ok, why, detail, verified = _attempt(base, sha, want_youcam)
        except Exception as e:  # noqa: BLE001 - a checker bug says nothing about the release
            return False, f"checker error: {type(e).__name__}", False
        if ok:
            return True, f"release {sha} ok: html, {detail}, evidence, gates", True
        if why == "401":
            return False, AUTH_401, False
        # The served release already matched, so this deployment holds a key: a retry cannot change it.
        if why == f"health: {KEY_LIVE}":
            return False, why, True
        last = why
        if n < attempts - 1:
            pause(10)
    return False, last, verified


def _read(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return None


def _done(ok: bool, msg: str) -> int:
    print(msg)
    return 0 if ok else 1


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: deploy_checks.py link|ci|ignored|scan|nokey|serving|release ...")
        return 2
    cmd, args = argv[0], argv[1:]
    if cmd == "link" and len(args) == 1:
        raw = _read(args[0])
        project = _json(raw) if raw is not None else None
        if linked_project_ok(project):
            return _done(True, f"linked to {PROJECT_NAME}")
        return _done(False, f"not linked to {PROJECT_NAME} ({PROJECT_ID})")
    if cmd == "ci" and len(args) == 2:
        try:
            floor = int(args[1])
        except ValueError:
            print("floor must be an integer")
            return 2
        raw = _read(args[0])
        data = _json(raw) if raw is not None else None
        if not isinstance(data, dict):
            return _done(False, "check-runs file is missing or not JSON")
        return _done(*ci_verdict(data, floor))
    if cmd == "ignored" and len(args) == 1:
        raw = _read(args[0])
        if raw is None:
            return _done(False, "porcelain file is missing")
        return _done(*ignored_ok(raw))
    if cmd == "scan" and len(args) == 1:
        raw = _read(args[0])
        if raw is None:
            return _done(False, "environment listing file is missing")
        return _done(*flags_ok(raw, os.environ))
    if cmd == "nokey" and len(args) == 1:
        raw = _read(args[0])
        if raw is None:
            return _done(False, "environment listing file is missing")
        return _done(*key_absent_ok(raw))
    if cmd == "serving" and len(args) == 1:
        status, body = _get(args[0].rstrip("/") + "/")
        if status == 0:
            print(f"serving none ({body})")
        elif status != 200:
            print(f"serving none (status {status})")
        else:
            sha = served_release(body)
            print(f"serving {sha}" if sha else "serving none (no cf-release)")
        return 0
    if cmd == "release" and len(args) in (2, 3):
        # --require-no-youcam: a preview or a paused production deploy, where health must say
        # youcam false. Without it, health must say youcam true.
        if len(args) == 3 and args[2] != "--require-no-youcam":
            print("unknown option: " + args[2])
            return 2
        raw = os.environ.get(ATTEMPTS_ENV)
        attempts = release_attempts(raw)
        if attempts is None:
            print(f"{ATTEMPTS_ENV} must be a whole number from 1 to {ATTEMPTS}, or unset")
            return 2
        if raw:
            # Said out loud: fewer attempts leave less time for a fresh deploy to start serving.
            plural = "" if attempts == 1 else "s"
            print(
                f"{ATTEMPTS_ENV}={raw}: {attempts} attempt{plural} instead of {ATTEMPTS} (for tests only)"
            )
        try:
            ok, msg, verified = release_check(
                args[0], args[1], want_youcam=len(args) == 2, attempts=attempts
            )
        except Exception as e:  # noqa: BLE001 - a checker bug must exit 4, never the rollback 1
            ok, msg, verified = False, f"checker error: {type(e).__name__}", False
        print(msg)
        if ok:
            return 0
        if verified:
            return 1
        # 4: nothing about the release was verified (unreachable from here, a checker error, or a
        # 401 protection setting), so callers must not treat it as a bad release.
        print("release not verified: this is not a release failure; do not roll back on it")
        return 4
    print(f"bad arguments for {cmd}")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

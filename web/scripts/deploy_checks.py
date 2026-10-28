"""Deploy gates for the Cast Forecast web app. Stdlib only, so the Mac needs nothing installed.

The two deploy scripts call this file for every verdict that needs real parsing: the linked Vercel
project, the CI check-runs for a SHA, what git would ship from ignored files, the SCAN_ENABLED
flag, and the live release check after a deploy. Every check fails closed: an empty, missing or
unparseable input is a failure, never a pass.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable

PROJECT_NAME = "cast-forecast-web"
SCOPE = "ssookra-7703s-projects"
AUTH_401 = "deployment is behind Vercel Authentication (401)"
PROJECT_ID = "prj_13eXRfxiEveDWgUuyKar6XOzl4Lm"
REQUIRED_JOBS = ("test", "web")
SCAN_FLAG = "SCAN_ENABLED"
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


def health_ok(body: dict, sha: str, require_youcam: bool = True) -> tuple[bool, str]:
    if not isinstance(body, dict):
        return False, "health body is not an object"
    if body.get("release") != sha:
        return False, f"release {body.get('release')}, want {sha}"
    if body.get("session") is not True:
        return False, "session secret not configured"
    if require_youcam and body.get("youcam") is not True:
        return False, "youcam not configured"
    node = body.get("node")
    if not isinstance(node, str) or not node.startswith("22."):
        return False, f"node {node}, want 22.x"
    return True, "ok"


def evidence_ok(html: str) -> bool:
    for row in re.findall(r"<tr\b.*?</tr>", html, flags=re.IGNORECASE | re.DOTALL):
        if "K1b" in row and "PASS" in row:
            return True
    return False


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


def scan_flag_ok(env_listing: str, local_value: str | None) -> tuple[bool, str]:
    """The scan flag must be unset in the target Vercel environment and in this shell.

    `vercel env ls` shows names only (sensitive values are never readable), so the rule is
    stricter than "0 or unset": any variable named SCAN_ENABLED in the target fails the deploy.
    A listing that does not name this project (empty, an error, the wrong project) is a failure,
    not a pass.
    """
    named = re.search(rf"{SCOPE}/{PROJECT_NAME}(?=\s|$)", env_listing)
    if not named or "Environment Variable" not in env_listing:
        return False, f"environment listing does not name {PROJECT_NAME} (the listing failed)"
    if re.search(rf"(?<![\w]){SCAN_FLAG}(?![\w])", env_listing):
        return False, f"{SCAN_FLAG} is set in the target environment"
    if local_value not in (None, "", "0"):
        return False, f"{SCAN_FLAG} is set in this shell"
    return True, f"ok: {SCAN_FLAG} is not set"


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


def _attempt(base: str, sha: str, require_youcam: bool) -> tuple[bool, str, str]:
    """One pass over the four pages. Returns (ok, message, health-detail)."""
    status, body = _get(f"{base}/")
    if status == 401:
        return False, "401", ""
    if status == 0:
        return False, f"html: {body}", ""
    if status != 200:
        return False, f"html: status {status}", ""
    if not release_in_html(body, sha):
        return False, f"html: cf-release is not {sha}", ""

    status, body = _get(f"{base}/api/health")
    if status == 401:
        return False, "401", ""
    if status == 0:
        return False, f"health: {body}", ""
    if status != 200:
        return False, f"health: status {status}", ""
    health = _json(body)
    ok, why = health_ok(health, sha, require_youcam)
    if not ok:
        return False, f"health: {why}", ""
    detail = (
        f"health (youcam={str(health.get('youcam') is True).lower()}, session=true, "
        f"node={health['node']})"
    )

    status, body = _get(f"{base}/evidence")
    if status == 401:
        return False, "401", ""
    if status == 0:
        return False, f"evidence: {body}", ""
    if status != 200:
        return False, f"evidence: status {status}", ""
    if not evidence_ok(body):
        return False, "evidence: no K1b PASS row", ""

    status, body = _get(f"{base}/api/gates")
    if status == 401:
        return False, "401", ""
    if status == 0:
        return False, f"gates: {body}", ""
    if status != 200:
        return False, f"gates: status {status}", ""
    ok, why = gates_ok(_json(body))
    if not ok:
        return False, f"gates: {why}", ""
    return True, "", detail


def release_check(
    base: str,
    sha: str,
    require_youcam: bool = True,
    attempts: int = 6,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[bool, str]:
    base = base.rstrip("/")
    last = "no attempt ran"
    for n in range(attempts):
        ok, why, detail = _attempt(base, sha, require_youcam)
        if ok:
            return True, f"release {sha} ok: html, {detail}, evidence, gates"
        if why == "401":
            return False, AUTH_401
        last = why
        if n < attempts - 1:
            sleep(10)
    return False, last


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
        print("usage: deploy_checks.py link|ci|ignored|scan|serving|release ...")
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
        return _done(*scan_flag_ok(raw, os.environ.get(SCAN_FLAG)))
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
        if len(args) == 3 and args[2] != "--allow-no-youcam":
            print("unknown option: " + args[2])
            return 2
        ok, msg = release_check(args[0], args[1], require_youcam=len(args) == 2)
        print(msg)
        if ok:
            return 0
        # 4: a protection setting, not a bad release, so callers must not treat it as one.
        return 4 if msg == AUTH_401 else 1
    print(f"bad arguments for {cmd}")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

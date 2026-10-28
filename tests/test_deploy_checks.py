"""Tests for the Vercel deploy gates (web/scripts/deploy_checks.py) and the two deploy scripts."""

import http.server
import importlib.util
import json
import os
import shutil
import subprocess
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "web" / "scripts"
_spec = importlib.util.spec_from_file_location("deploy_checks", SCRIPTS / "deploy_checks.py")
dc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dc)

# The gates table exactly as a real /evidence render serves it (tests/fixtures/README.md says how it
# was made). The release check must read this shape, not a hand-built one.
GATE_TABLE = (ROOT / "tests" / "fixtures" / "evidence-gate-table.html").read_text(encoding="utf-8")
K1B_PASS = 'role="row" data-gate="K1b" data-verdict="PASS"'
EVIDENCE = f"<html><body><main><h1>Evidence</h1>{GATE_TABLE}</main></body></html>"


@pytest.fixture(autouse=True)
def _no_attempts_override(monkeypatch):
    """A RELEASE_ATTEMPTS left in the developer's shell must not change these tests."""
    monkeypatch.delenv("RELEASE_ATTEMPTS", raising=False)


def runs(*pairs):
    return {"check_runs": [{"name": n, "conclusion": c} for n, c in pairs]}


def test_link_requires_cast_forecast_web():
    assert dc.linked_project_ok(
        {
            "projectName": "cast-forecast-web",
            "projectId": "prj_13eXRfxiEveDWgUuyKar6XOzl4Lm",
            "orgId": "team_x",
        }
    )
    assert not dc.linked_project_ok(
        {"projectName": "web", "projectId": "prj_other", "orgId": "team_x"}
    )
    assert not dc.linked_project_ok({"projectId": "prj_13eXRfxiEveDWgUuyKar6XOzl4Lm"})
    assert not dc.linked_project_ok(None)


def test_ci_empty_is_not_green():
    assert dc.ci_verdict(runs(), 2) == (False, "missing check-run: test")


def test_ci_requires_each_named_job():
    got = dc.ci_verdict(runs(("test", "success"), ("test", "success")), 2)
    assert got == (False, "missing check-run: web")


def test_ci_requires_count_floor():
    got = dc.ci_verdict(runs(("test", "success"), ("web", "success")), 3)
    assert got == (False, "2 gated check-runs, need 3")


def test_ci_rejects_pending_failure_skipped_cancelled_neutral():
    for c in (None, "failure", "skipped", "cancelled", "neutral"):
        got = dc.ci_verdict(runs(("test", "success"), ("web", c)), 2)
        assert got == (False, f"web is {c or 'pending'}")


def test_ci_passes_at_floor_and_reports_ungated_checks():
    got = dc.ci_verdict(
        runs(
            ("test", "success"),
            ("web", "success"),
            ("Greptile", "neutral"),
            ("Socket Security", "failure"),
        ),
        2,
    )
    assert got == (
        True,
        "ok: 2 gated check-runs; not gated: Greptile=neutral, Socket Security=failure",
    )


def test_ci_counts_push_and_pull_request_duplicates():
    both = runs(("test", "success"), ("web", "success"), ("test", "success"), ("web", "success"))
    assert dc.ci_verdict(both, 2)[0]
    one_red = runs(("test", "success"), ("web", "success"), ("test", "success"), ("web", "failure"))
    assert not dc.ci_verdict(one_red, 2)[0]


def test_ci_malformed_input_is_not_green():
    assert not dc.ci_verdict({}, 2)[0]
    assert not dc.ci_verdict({"check_runs": "nope"}, 2)[0]
    assert not dc.ci_verdict({"check_runs": [None, 3]}, 2)[0]


def test_release_meta_found_absent_and_other_sha():
    html = '<head><meta name="cf-release" content="abc"/></head>'
    assert dc.release_in_html(html, "abc")
    assert not dc.release_in_html(html, "abd")
    assert not dc.release_in_html("<head></head>", "abc")


def test_health_requires_release_node_key_and_secret():
    good = {"release": "abc", "youcam": True, "session": True, "node": "22.23.2"}
    assert dc.health_ok(good, "abc") == (True, "ok")
    assert dc.health_ok({**good, "youcam": False}, "abc") == (False, "youcam not configured")
    assert dc.health_ok({**good, "youcam": False}, "abc", want_youcam=False) == (True, "ok")
    assert dc.health_ok({**good, "session": False}, "abc") == (
        False,
        "session secret not configured",
    )
    assert dc.health_ok({**good, "release": "abd"}, "abc") == (False, "release abd, want abc")
    assert dc.health_ok({**good, "node": "24.1.0"}, "abc") == (False, "node 24.1.0, want 22.x")


def test_health_without_a_key_requires_youcam_exactly_false():
    # Codex r1 finding C: a preview or a paused production deploy must not hold an active key.
    good = {"release": "abc", "youcam": False, "session": True, "node": "22.23.2"}
    assert dc.health_ok(good, "abc", want_youcam=False) == (True, "ok")
    assert dc.health_ok({**good, "youcam": True}, "abc", want_youcam=False) == (
        False,
        "youcam is true on a deploy that must hold no key",
    )
    missing = {k: v for k, v in good.items() if k != "youcam"}
    assert dc.health_ok(missing, "abc", want_youcam=False) == (False, "youcam is null, want false")
    for odd in ("false", 0, None, []):
        assert dc.health_ok({**good, "youcam": odd}, "abc", want_youcam=False)[0] is False, odd


def test_evidence_reads_the_k1b_pass_row_as_gate_table_renders_it():
    # The fixture is not vacuous: it holds the K1b row, other gates' rows and the header row.
    assert GATE_TABLE.count(K1B_PASS) == 1
    assert GATE_TABLE.count('role="row"') == 5 and "<tr" not in GATE_TABLE
    assert dc.evidence_ok(EVIDENCE)
    assert dc.evidence_ok(GATE_TABLE)


def test_evidence_refuses_k1b_fail_and_pass_text_outside_a_row():
    k1b_fail = EVIDENCE.replace(K1B_PASS, 'role="row" data-gate="K1b" data-verdict="FAIL"')
    assert k1b_fail != EVIDENCE and not dc.evidence_ok(k1b_fail)
    # K1b PASS as text, but not on a role="row" element carrying both attributes.
    for html in (
        "<p>K1b PASS 5 of 5</p>",
        "<table><tr><td>K1b</td><td>Same question</td><td>PASS 5 of 5</td></tr></table>",
        '<div role="row"><div role="cell">K1b</div><div role="cell">PASS 5 of 5</div></div>',
        EVIDENCE.replace(K1B_PASS, 'data-gate="K1b" data-verdict="PASS"'),
        EVIDENCE.replace(K1B_PASS, 'role="cell" data-gate="K1b" data-verdict="PASS"'),
        EVIDENCE.replace(K1B_PASS, 'role="row" data-gate="K1" data-verdict="PASS"'),
        k1b_fail + "<p>K1b PASS</p>",
        "<p>Evidence</p>",
        "",
    ):
        assert not dc.evidence_ok(html), html[:80]


def test_gates_need_every_inverse_check_to_match():
    assert dc.gates_ok({"k1b": {"inverseCheck": [{"match": True}] * 3}}) == (True, "ok")
    two = {"k1b": {"inverseCheck": [{"match": True}, {"match": False}]}}
    assert dc.gates_ok(two) == (False, "inverse check 2 does not match")
    assert dc.gates_ok({"k1b": {"inverseCheck": []}}) == (False, "no inverse checks")
    assert dc.gates_ok({}) == (False, "no inverse checks")


def test_main_ci_exit_codes(tmp_path):
    p = tmp_path / "runs.json"
    p.write_text(json.dumps(runs(("test", "success"), ("web", "success"))))
    assert dc.main(["ci", str(p), "2"]) == 0
    p.write_text(json.dumps(runs(("test", "success"))))
    assert dc.main(["ci", str(p), "2"]) == 1
    p.write_text("not json")
    assert dc.main(["ci", str(p), "2"]) == 1
    assert dc.main(["ci", str(tmp_path / "missing.json"), "2"]) == 1
    assert dc.main(["ci"]) == 2


def test_main_link_exit_codes(tmp_path):
    p = tmp_path / "project.json"
    p.write_text(
        json.dumps(
            {"projectName": "cast-forecast-web", "projectId": "prj_13eXRfxiEveDWgUuyKar6XOzl4Lm"}
        )
    )
    assert dc.main(["link", str(p)]) == 0
    p.write_text(json.dumps({"projectName": "web", "projectId": "prj_x"}))
    assert dc.main(["link", str(p)]) == 1
    assert dc.main(["link", str(tmp_path / "missing.json")]) == 1


def test_served_release_reads_the_meta_tag():
    assert dc.served_release('<head><meta name="cf-release" content="abc"/></head>') == "abc"
    assert dc.served_release("<head></head>") is None


def test_ignored_paths_must_be_excluded_from_the_upload():
    ok = (
        "!! web/node_modules/\n!! web/.next/\n!! web/.env.local\n!! web/src/.DS_Store\n"
        "!! web/scripts/__pycache__/\n?? web/new.ts\n"
    )
    assert dc.ignored_ok(ok) == (True, "ok: 5 ignored paths, all excluded from the upload")
    assert dc.ignored_ok(ok + "!! web/selfie.jpg\n") == (
        False,
        "ignored path would ship: web/selfie.jpg",
    )
    assert dc.ignored_ok("") == (True, "ok: 0 ignored paths, all excluded from the upload")


NO_VARS = (
    "Vercel CLI 62.1.0\nRetrieving project...\n"
    "> No Environment Variables found for ssookra-7703s-projects/cast-forecast-web [204ms]\n"
)
SOME_VARS = (
    "Vercel CLI 62.1.0\n> Environment Variables found for ssookra-7703s-projects/cast-forecast-web\n"
    " name                          value       environments   created\n"
    " SESSION_SECRET                Encrypted   Production     1d ago\n"
)


def test_scan_flag_must_be_unset_in_the_target_and_the_shell():
    assert dc.scan_flag_ok(NO_VARS, None)[0]
    assert dc.scan_flag_ok(SOME_VARS, "0")[0]
    assert dc.scan_flag_ok(SOME_VARS, "")[0]
    with_flag = SOME_VARS + " SCAN_ENABLED                  Encrypted   Production     1m ago\n"
    assert dc.scan_flag_ok(with_flag, None) == (
        False,
        "SCAN_ENABLED is set in the target environment",
    )
    # Even a value of 0 is refused: values are not readable, so presence is the rule.
    assert not dc.scan_flag_ok(with_flag, "0")[0]
    assert dc.scan_flag_ok(SOME_VARS, "1") == (False, "SCAN_ENABLED is set in this shell")
    assert dc.scan_flag_ok(SOME_VARS, "true")[0] is False
    # A name that merely contains the flag name is a different variable.
    assert dc.scan_flag_ok(SOME_VARS + " NOT_SCAN_ENABLED_X  Encrypted  Production\n", None)[0]


def test_scan_listing_must_name_exactly_this_project():
    staging = SOME_VARS.replace("cast-forecast-web", "cast-forecast-web-staging")
    assert dc.scan_flag_ok(staging, None)[0] is False
    other_scope = SOME_VARS.replace("ssookra-7703s-projects", "someone-else")
    assert dc.scan_flag_ok(other_scope, None)[0] is False
    assert dc.scan_flag_ok(SOME_VARS.rstrip("\n"), None)[0]


def test_scan_listing_that_failed_is_not_a_pass():
    for bad in (
        "",
        "\n",
        "Error: not logged in\n",
        "No Environment Variables found for other/proj",
    ):
        assert dc.scan_flag_ok(bad, None)[0] is False


def test_main_scan_reads_the_listing_and_the_shell(tmp_path, monkeypatch):
    p = tmp_path / "env.txt"
    p.write_text(NO_VARS)
    monkeypatch.delenv("SCAN_ENABLED", raising=False)
    assert dc.main(["scan", str(p)]) == 0
    monkeypatch.setenv("SCAN_ENABLED", "1")
    assert dc.main(["scan", str(p)]) == 1
    monkeypatch.delenv("SCAN_ENABLED")
    p.write_text("")
    assert dc.main(["scan", str(p)]) == 1
    assert dc.main(["scan", str(tmp_path / "missing.txt")]) == 1
    assert dc.main(["scan"]) == 2


WITH_KEY = SOME_VARS + " YOUCAM_API_KEY                Encrypted   Preview        2d ago\n"


def test_key_must_be_absent_from_a_keyless_target():
    # Codex r1 finding C: values are not readable, so presence of the name alone fails.
    assert dc.key_absent_ok(NO_VARS) == (True, "ok: YOUCAM_API_KEY is not set")
    assert dc.key_absent_ok(SOME_VARS)[0]
    assert dc.key_absent_ok(WITH_KEY) == (False, "YOUCAM_API_KEY is set in the target environment")
    # A name that merely contains the key name is a different variable.
    assert dc.key_absent_ok(SOME_VARS + " OLD_YOUCAM_API_KEY_X  Encrypted  Preview\n")[0]


def test_key_check_on_a_failed_listing_is_not_a_pass():
    for bad in (
        "",
        "Error: not logged in\n",
        "No Environment Variables found for other/proj",
        SOME_VARS.replace("cast-forecast-web", "cast-forecast-web-staging"),
    ):
        assert dc.key_absent_ok(bad)[0] is False, bad


def test_main_nokey_exit_codes(tmp_path):
    p = tmp_path / "env.txt"
    p.write_text(NO_VARS)
    assert dc.main(["nokey", str(p)]) == 0
    p.write_text(WITH_KEY)
    assert dc.main(["nokey", str(p)]) == 1
    p.write_text("")
    assert dc.main(["nokey", str(p)]) == 1
    assert dc.main(["nokey", str(tmp_path / "missing.txt")]) == 1
    assert dc.main(["nokey"]) == 2


SHA = "abc1234"
HEALTH = {"release": SHA, "youcam": True, "session": True, "node": "22.23.2"}
PAGES = {
    "/": [(200, f'<head><meta name="cf-release" content="{SHA}"/></head>')],
    "/api/health": [(200, HEALTH)],
    "/evidence": [(200, EVIDENCE)],
    "/api/gates": [(200, {"k1b": {"inverseCheck": [{"match": True}] * 3}})],
}
OK_LINE = (
    f"release {SHA} ok: html, health (youcam=true, session=true, node=22.23.2), evidence, gates"
)


@pytest.fixture
def site():
    servers = []

    def start(overrides=None):
        pages = {**PAGES, **(overrides or {})}
        state = {path: list(replies) for path, replies in pages.items()}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                replies = state.get(self.path)
                if not replies:
                    status, body = 404, ""
                else:
                    status, body = replies[0] if len(replies) == 1 else replies.pop(0)
                data = (json.dumps(body) if isinstance(body, dict) else body).encode()
                self.send_response(status)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
        return f"http://127.0.0.1:{server.server_address[1]}"

    yield start
    for s in servers:
        s.shutdown()
        s.server_close()


def test_release_passes_when_all_four_pass_in_one_attempt(site):
    sleeps = []
    assert dc.release_check(site(), SHA, sleep=sleeps.append) == (True, OK_LINE, True)
    assert sleeps == []


def test_release_retries_until_one_attempt_passes_all_four(site):
    sleeps = []
    base = site({"/api/health": [(200, {**HEALTH, "release": "old"}), (200, HEALTH)]})
    assert dc.release_check(base, SHA, sleep=sleeps.append) == (True, OK_LINE, True)
    assert sleeps == [10]


def test_release_gives_up_after_the_last_attempt(site):
    sleeps = []
    base = site({"/evidence": [(500, "")]})
    got = dc.release_check(base, SHA, attempts=3, sleep=sleeps.append)
    assert got == (False, "evidence: status 500", True)
    assert sleeps == [10, 10]


def test_release_stops_at_once_on_401(site):
    sleeps = []
    got = dc.release_check(site({"/": [(401, "")]}), SHA, sleep=sleeps.append)
    assert got == (False, "deployment is behind Vercel Authentication (401)", False)
    assert sleeps == []


def test_release_requires_youcam_true_live_and_false_without_a_key(site):
    base = site({"/api/health": [(200, {**HEALTH, "youcam": False})]})
    got = dc.release_check(base, SHA, attempts=1)
    assert got == (False, "health: youcam not configured", True)
    got = dc.release_check(base, SHA, want_youcam=False, attempts=1)
    assert got == (True, OK_LINE.replace("youcam=true", "youcam=false"), True)


def test_release_without_a_key_fails_at_once_on_an_active_key(site):
    # Codex r1 finding C: the release SHA already matched, so a retry cannot change the answer.
    sleeps = []
    got = dc.release_check(site(), SHA, want_youcam=False, sleep=sleeps.append)
    assert got == (False, "health: youcam is true on a deploy that must hold no key", True)
    assert sleeps == []


def test_release_names_the_failing_inverse_check(site):
    bad = {"k1b": {"inverseCheck": [{"match": True}, {"match": False}]}}
    base = site({"/api/gates": [(200, bad)]})
    assert dc.release_check(base, SHA, attempts=1) == (
        False,
        "gates: inverse check 2 does not match",
        True,
    )


def test_release_unreachable_and_wrong_sha_and_no_evidence_row(site):
    got = dc.release_check("http://127.0.0.1:9", SHA, attempts=1)
    assert got[0] is False and got[1].startswith("html: unreachable (") and got[2] is False
    other = site({"/": [(200, '<meta name="cf-release" content="zzz"/>')]})
    got = dc.release_check(other, SHA, attempts=1)
    assert got == (False, f"html: cf-release is not {SHA}", True)
    noev = site({"/evidence": [(200, "<p>Evidence</p>")]})
    assert dc.release_check(noev, SHA, attempts=1) == (False, "evidence: no K1b PASS row", True)


# Codex r2 finding G: only a fetched response that mismatched is a verified failure. When the last
# attempt could not fetch a page, or the checker raised, nothing about the release is known.
def _scripted_get(plan):
    """A stand-in for _get serving PAGES. `plan` names each attempt: "ok", "down" (every fetch
    fails at the transport) or "bad" (/evidence answers 500); the last entry repeats."""
    state = {"attempt": -1}

    def fake(url):
        path = url.split("127.0.0.1:1", 1)[1] or "/"
        if path == "/":
            state["attempt"] += 1
        kind = plan[min(state["attempt"], len(plan) - 1)]
        if kind == "down":
            return 0, "unreachable (connection refused)"
        if kind == "bad" and path == "/evidence":
            return 500, ""
        status, body = PAGES[path][0]
        return status, json.dumps(body) if isinstance(body, dict) else body

    return fake


@pytest.mark.parametrize(
    ("plan", "verified", "message"),
    [
        (["down"], False, "html: unreachable (connection refused)"),
        (["bad", "down"], False, "html: unreachable (connection refused)"),
        (["down", "bad"], True, "evidence: status 500"),
    ],
)
def test_release_verdict_follows_the_last_attempt(monkeypatch, plan, verified, message):
    monkeypatch.setattr(dc, "_get", _scripted_get(plan))
    sleeps = []
    got = dc.release_check("http://127.0.0.1:1", SHA, attempts=3, sleep=sleeps.append)
    assert got == (False, message, verified)
    assert sleeps == [10, 10]


def test_release_checker_exception_is_unverified_at_once(monkeypatch):
    def boom(*_args):
        raise RuntimeError("bug")

    monkeypatch.setattr(dc, "_attempt", boom)
    sleeps = []
    got = dc.release_check("http://127.0.0.1:1", SHA, sleep=sleeps.append)
    assert got == (False, "checker error: RuntimeError", False)
    assert sleeps == []


def test_main_release_exit_codes_verified_1_unverified_4(monkeypatch, site, capsys):
    monkeypatch.setattr(dc.time, "sleep", lambda _s: None)
    assert dc.main(["release", site({"/evidence": [(500, "")]}), SHA]) == 1
    assert dc.main(["release", "http://127.0.0.1:9", SHA]) == 4
    out = capsys.readouterr().out
    assert "evidence: status 500" in out and "html: unreachable (" in out
    assert "not verified" in out.splitlines()[-1]
    monkeypatch.setattr(dc, "_get", _scripted_get(["bad", "down"]))
    assert dc.main(["release", "http://127.0.0.1:1", SHA]) == 4


def test_main_release_checker_exception_is_4(monkeypatch, capsys):
    def boom(*_args, **_kwargs):
        raise RuntimeError("bug")

    monkeypatch.setattr(dc, "_attempt", boom)
    assert dc.main(["release", "http://127.0.0.1:1", SHA]) == 4
    monkeypatch.setattr(dc, "release_check", boom)
    assert dc.main(["release", "http://127.0.0.1:1", SHA]) == 4
    assert "checker error: RuntimeError" in capsys.readouterr().out


def test_main_release_and_serving(site, capsys):
    base = site()
    assert dc.main(["release", base, SHA]) == 0
    assert dc.main(["serving", base]) == 0
    assert capsys.readouterr().out.splitlines() == [OK_LINE, f"serving {SHA}"]
    assert dc.main(["serving", "http://127.0.0.1:9"]) == 0
    assert capsys.readouterr().out.startswith("serving none (")
    assert dc.main(["release"]) == 2


def test_release_attempts_override_is_a_whole_number_from_1_to_6():
    assert dc.release_attempts(None) == 6
    assert dc.release_attempts("") == 6
    assert dc.release_attempts("1") == 1
    assert dc.release_attempts("6") == 6
    for bad in ("0", "7", "-1", "two", " 1", "1.5", "1e1"):
        assert dc.release_attempts(bad) is None, bad


def test_main_release_reads_release_attempts(monkeypatch, site, capsys):
    sleeps = []
    monkeypatch.setattr(dc.time, "sleep", sleeps.append)
    base = site({"/evidence": [(500, "")]})
    monkeypatch.setenv("RELEASE_ATTEMPTS", "2")
    assert dc.main(["release", base, SHA]) == 1
    assert sleeps == [10]
    out = capsys.readouterr().out
    assert out.splitlines()[0] == "RELEASE_ATTEMPTS=2: 2 attempts instead of 6 (for tests only)"
    monkeypatch.setenv("RELEASE_ATTEMPTS", "0")
    assert dc.main(["release", base, SHA]) == 2
    assert "RELEASE_ATTEMPTS" in capsys.readouterr().out
    monkeypatch.delenv("RELEASE_ATTEMPTS")
    sleeps.clear()
    assert dc.main(["release", base, SHA]) == 1
    assert sleeps == [10] * 5
    assert "RELEASE_ATTEMPTS" not in capsys.readouterr().out


def test_main_release_exits_4_behind_vercel_authentication(site):
    assert dc.main(["release", site({"/": [(401, "")]}), SHA]) == 4


def test_main_release_require_no_youcam_flag(site):
    keyless = site({"/api/health": [(200, {**HEALTH, "youcam": False})]})
    assert dc.main(["release", keyless, SHA, "--require-no-youcam"]) == 0
    assert dc.main(["release", site(), SHA, "--require-no-youcam"]) == 1
    # The old flag only relaxed the check; it is now an unknown option, so an old caller fails loudly.
    assert dc.main(["release", keyless, SHA, "--allow-no-youcam"]) == 2


# ---- the deploy scripts themselves, run against a throwaway repo with fake pnpm and gh ----

FAKE_PNPM = """#!/usr/bin/env bash
# Stands in for: pnpm dlx --allow-build=esbuild vercel@62.1.0 <command> ...
[ "$1" = "dlx" ] || { echo "fake pnpm: unexpected $*"; exit 98; }
shift 3
echo "$*" >> "$FAKE_LOG"
case "$1" in
  env)
    if [ -n "${FAKE_ENV_FAIL:-}" ]; then echo "Error: not logged in"; exit 1; fi
    cat "$FAKE_ENV_LS"; exit 0 ;;
  deploy)
    if [ -n "${FAKE_DEPLOY_FAIL:-}" ]; then echo "Error: build failed" >&2; exit 1; fi
    cat "$FAKE_DEPLOY_OUT"; exit 0 ;;
  inspect)
    if [ -n "${FAKE_INSPECT_FAIL:-}" ]; then echo "Error: inspect failed"; exit 1; fi
    cat "$FAKE_INSPECT_OUT"; exit 0 ;;
esac
echo "unexpected vercel call: $*"; exit 99
"""
FAKE_GH = """#!/usr/bin/env bash
echo "gh $*" >> "$FAKE_LOG"
case "$*" in
  *commits/main*)
    if [ -n "${FAKE_GH_MAIN_FAIL:-}" ]; then exit 1; fi
    echo "$FAKE_MAIN_SHA"; exit 0 ;;
esac
if [ -n "${FAKE_GH_FAIL:-}" ]; then exit 1; fi
cat "$FAKE_CI"
"""
GOOD_PROJECT = {
    "projectName": "cast-forecast-web",
    "projectId": "prj_13eXRfxiEveDWgUuyKar6XOzl4Lm",
    "orgId": "team_x",
}
ALIAS_LINE = "    Aliases     https://cast-forecast-web.vercel.app\n"
FAKE_URL = "https://cast-forecast-abc123.vercel.app"


def _git(cwd, *args):
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


class Rig:
    def __init__(self, tmp_path):
        self.tmp = tmp_path
        self.origin = tmp_path / "origin.git"
        self.work = tmp_path / "work"
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(self.origin)], check=True)
        self.work.mkdir()
        _git(self.work, "init", "-q", "-b", "main")
        (self.work / "web" / "scripts").mkdir(parents=True)
        for name in ("deploy_checks.py", "deploy-prod.sh", "deploy-preview.sh"):
            shutil.copy(SCRIPTS / name, self.work / "web" / "scripts" / name)
        (self.work / ".gitignore").write_text(".env.*\n__pycache__/\n")
        (self.work / "web" / ".gitignore").write_text(".vercel\n.env*.local\n")
        (self.work / "web" / ".vercel").mkdir()
        (self.work / "web" / ".vercel" / "project.json").write_text(json.dumps(GOOD_PROJECT))
        _git(self.work, "add", ".")
        _git(self.work, "commit", "-q", "-m", "init")
        _git(self.work, "remote", "add", "origin", str(self.origin))
        _git(self.work, "push", "-q", "-u", "origin", "main")
        self.bin = tmp_path / "bin"
        self.bin.mkdir()
        for name, body in (("pnpm", FAKE_PNPM), ("gh", FAKE_GH)):
            (self.bin / name).write_text(body)
            (self.bin / name).chmod(0o755)
        self.log = tmp_path / "calls.log"
        self.log.write_text("")
        self.env_ls = tmp_path / "env_ls.txt"
        self.env_ls.write_text(NO_VARS)
        self.deploy_out = tmp_path / "deploy_out.txt"
        self.deploy_out.write_text(FAKE_URL + "\n")
        self.inspect_out = tmp_path / "inspect_out.txt"
        self.inspect_out.write_text(ALIAS_LINE)
        self.ci = tmp_path / "ci.json"
        self.set_ci(("test", "success"), ("web", "success"))
        self.main_sha = None

    def set_ci(self, *pairs):
        self.ci.write_text(json.dumps(runs(*pairs)))

    def head(self):
        return _git(self.work, "rev-parse", "HEAD")

    def run(self, script, *args, **extra):
        env = {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "FAKE_LOG": str(self.log),
            "FAKE_CI": str(self.ci),
            "FAKE_ENV_LS": str(self.env_ls),
            "FAKE_DEPLOY_OUT": str(self.deploy_out),
            "FAKE_INSPECT_OUT": str(self.inspect_out),
            "FAKE_MAIN_SHA": self.main_sha or _git(self.origin, "rev-parse", "main"),
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        for name in (
            "SCAN_ENABLED",
            "DRY_RUN",
            "VERCEL_ORG_ID",
            "VERCEL_PROJECT_ID",
            "PROD_URL",
            "RELEASE_ATTEMPTS",
        ):
            env.pop(name, None)
        env.update(extra)
        out = self.tmp / "out.txt"
        with out.open("w") as f:
            p = subprocess.run(
                ["bash", str(self.work / "web" / "scripts" / script), *args],
                check=False,
                cwd=self.work,
                env=env,
                stdout=f,
                stderr=subprocess.STDOUT,
            )
        return p.returncode, out.read_text()

    def calls(self):
        return self.log.read_text().splitlines()

    def deployed(self):
        return [c for c in self.calls() if c.startswith(("deploy", "promote", "rollback"))]


@pytest.fixture
def rig(tmp_path):
    return Rig(tmp_path)


def _alias(rig, base):
    """Make the fake `vercel inspect` list the fixture site as the production alias."""
    rig.inspect_out.write_text(f"    Aliases     {base.removeprefix('http://')}\n")
    return base


def _pages(sha, **overrides):
    return {
        "/": [(200, f'<head><meta name="cf-release" content="{sha}"/></head>')],
        "/api/health": [(200, {**HEALTH, "release": sha})],
        **overrides,
    }


def test_prod_dry_run_passes_every_gate_and_deploys_nothing(rig):
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1")
    assert code == 0, out
    assert out.splitlines()[-1] == "DRY_RUN=1: gates passed, nothing deployed"
    assert "deployment:" not in out
    assert rig.deployed() == []
    assert any(c.startswith("env ls production") for c in rig.calls())


def test_any_dry_run_value_but_empty_or_zero_is_a_dry_run(rig, site):
    for value in ("true", "yes", "2"):
        code, out = rig.run("deploy-prod.sh", DRY_RUN=value)
        assert code == 0 and "nothing deployed" in out, value
    assert rig.deployed() == []
    sha = rig.head()
    for value in ("", "0"):
        base = _alias(rig, site(_pages(sha)))
        code, out = rig.run("deploy-prod.sh", DRY_RUN=value, PROD_URL=base)
        assert "deployment:" in out, (value, out)
    assert len(rig.deployed()) == 2


def test_prod_refuses_a_branch_head(rig):
    _git(rig.work, "checkout", "-q", "-b", "feature")
    (rig.work / "f.txt").write_text("x")
    _git(rig.work, "add", "f.txt")
    _git(rig.work, "commit", "-q", "-m", "feature work")
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1")
    assert code == 1
    assert out.splitlines()[-1] == "HEAD is not origin/main"
    assert "deployment:" not in out
    assert rig.deployed() == []


def test_prod_refuses_when_github_main_is_not_this_sha(rig):
    rig.main_sha = "0" * 40
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1")
    assert code == 1 and "DRY_RUN=1" not in out
    rig.main_sha = None
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1", FAKE_GH_MAIN_FAIL="1")
    assert code == 1 and "DRY_RUN=1" not in out
    assert rig.deployed() == []


@pytest.mark.parametrize("script", ["deploy-prod.sh", "deploy-preview.sh"])
def test_scripts_refuse_a_dirty_tree(rig, script):
    if script == "deploy-preview.sh":
        _git(rig.work, "checkout", "-q", "-b", "feature")
        _git(rig.work, "push", "-q", "-u", "origin", "feature")
    (rig.work / "web" / "stray.txt").write_text("x")
    code, out = rig.run(script, DRY_RUN="1")
    assert code == 1 and "deployment:" not in out
    assert rig.deployed() == []


@pytest.mark.parametrize("script", ["deploy-prod.sh", "deploy-preview.sh"])
def test_scripts_see_untracked_and_ignored_files_even_if_git_is_configured_not_to(rig, script):
    if script == "deploy-preview.sh":
        _git(rig.work, "checkout", "-q", "-b", "feature")
        _git(rig.work, "push", "-q", "-u", "origin", "feature")
    _git(rig.work, "config", "status.showUntrackedFiles", "no")
    (rig.work / "web" / "new.ts").write_text("x")
    code, out = rig.run(script, DRY_RUN="1")
    assert code == 1 and "not clean" in out, out
    (rig.work / "web" / "new.ts").unlink()
    (rig.work / ".gitignore").write_text(".env.*\n__pycache__/\n*.jpg\n")
    _git(rig.work, "add", ".gitignore")
    _git(rig.work, "commit", "-q", "-m", "ignore jpg")
    _git(rig.work, "push", "-q", "origin", "HEAD")
    (rig.work / "web" / "selfie.jpg").write_text("x")
    code, out = rig.run(script, DRY_RUN="1")
    assert code == 1 and "ignored path would ship: web/selfie.jpg" in out, out
    assert rig.deployed() == []


@pytest.mark.parametrize("script", ["deploy-prod.sh", "deploy-preview.sh"])
def test_scripts_refuse_an_ignored_listing_that_cannot_see_the_link(rig, script):
    # A tracked project.json makes the ignored listing lack `!! web/.vercel/`: the listing is
    # not trustworthy, so nothing deploys.
    if script == "deploy-preview.sh":
        _git(rig.work, "checkout", "-q", "-b", "feature")
    _git(rig.work, "add", "-f", "web/.vercel/project.json")
    _git(rig.work, "commit", "-q", "-m", "track link")
    _git(rig.work, "push", "-q", "-u", "origin", "HEAD")
    code, out = rig.run(script, DRY_RUN="1")
    assert code == 1 and "ignored listing" in out, out
    assert rig.deployed() == []


@pytest.mark.parametrize("script", ["deploy-prod.sh", "deploy-preview.sh"])
def test_scripts_refuse_project_overrides_from_the_environment(rig, script):
    for name in ("VERCEL_ORG_ID", "VERCEL_PROJECT_ID"):
        code, out = rig.run(script, DRY_RUN="1", **{name: "x"})
        assert code == 1 and name in out, out
    assert rig.calls() == []


def test_prod_refuses_an_unlinked_or_wrong_project(rig):
    project = rig.work / "web" / ".vercel" / "project.json"
    project.write_text(json.dumps({"projectName": "web", "projectId": "prj_other"}))
    assert rig.run("deploy-prod.sh", DRY_RUN="1")[0] == 1
    project.unlink()
    assert rig.run("deploy-prod.sh", DRY_RUN="1")[0] == 1
    assert rig.deployed() == []


def test_prod_refuses_red_missing_or_unreadable_ci(rig):
    rig.set_ci(("test", "success"), ("web", "failure"))
    assert rig.run("deploy-prod.sh", DRY_RUN="1")[0] == 1
    rig.set_ci(("test", "success"))
    assert rig.run("deploy-prod.sh", DRY_RUN="1")[0] == 1
    rig.set_ci()
    assert rig.run("deploy-prod.sh", DRY_RUN="1")[0] == 1
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1", FAKE_GH_FAIL="1")
    assert code == 1 and "DRY_RUN=1" not in out
    assert rig.deployed() == []


def test_prod_refuses_when_the_scan_flag_is_set_anywhere(rig):
    rig.env_ls.write_text(SOME_VARS + " SCAN_ENABLED  Encrypted  Production  1m ago\n")
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1")
    assert code == 1 and "SCAN_ENABLED" in out and "DRY_RUN=1" not in out
    rig.env_ls.write_text(NO_VARS)
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1", SCAN_ENABLED="1")
    assert code == 1 and "SCAN_ENABLED" in out and "DRY_RUN=1" not in out
    code, _ = rig.run("deploy-prod.sh", DRY_RUN="1", SCAN_ENABLED="0")
    assert code == 0
    assert rig.deployed() == []


def test_prod_refuses_when_the_env_listing_fails(rig):
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1", FAKE_ENV_FAIL="1")
    assert code == 1 and "DRY_RUN=1" not in out
    assert rig.deployed() == []


def test_prod_rejects_unknown_arguments(rig):
    assert rig.run("deploy-prod.sh", "--nope", DRY_RUN="1")[0] == 2
    assert rig.deployed() == []


def test_prod_deploys_and_verifies(rig, site):
    sha = rig.head()
    code, out = rig.run("deploy-prod.sh", PROD_URL=_alias(rig, site(_pages(sha))) + "/")
    assert code == 0, out
    assert f"deployment: {FAKE_URL}" in out and f"serving {sha}" in out
    assert out.splitlines()[-1].startswith(f"release {sha} ok: html, health")
    assert any(
        c.startswith("deploy --prod") and f"NEXT_PUBLIC_RELEASE_SHA={sha}" in c for c in rig.calls()
    )
    log = (rig.work / "web" / ".vercel" / "deploy-log.txt").read_text()
    assert f"deployment {FAKE_URL} sha {sha} mode live" in log
    assert f"before {sha}" in log


def test_prod_paused_allows_no_youcam(rig, site):
    sha = rig.head()
    pages = _pages(sha, **{"/api/health": [(200, {**HEALTH, "release": sha, "youcam": False})]})
    base = _alias(rig, site(pages))
    code, out = rig.run("deploy-prod.sh", "--paused", PROD_URL=base)
    assert code == 0, out
    assert "youcam=false" in out.splitlines()[-1]
    assert "mode paused" in (rig.work / "web" / ".vercel" / "deploy-log.txt").read_text()


PROD_KEY = SOME_VARS + " YOUCAM_API_KEY                Encrypted   Production     2d ago\n"


def test_prod_paused_refuses_before_deploying_while_production_lists_the_key(rig, site):
    # Codex r1 finding C: a paused deploy with the key still in production would serve it.
    sha = rig.head()
    pages = _pages(sha, **{"/api/health": [(200, {**HEALTH, "release": sha, "youcam": False})]})
    base = _alias(rig, site(pages))
    rig.env_ls.write_text(PROD_KEY)
    code, out = rig.run("deploy-prod.sh", "--paused", PROD_URL=base)
    assert code == 1 and "YOUCAM_API_KEY" in out and "deployment:" not in out, out
    code, out = rig.run("deploy-prod.sh", "--paused", DRY_RUN="1")
    assert code == 1 and "DRY_RUN=1" not in out, out
    code, out = rig.run("deploy-prod.sh", "--paused", DRY_RUN="1", FAKE_ENV_FAIL="1")
    assert code == 1 and "DRY_RUN=1" not in out, out
    assert rig.deployed() == []


def test_prod_live_deploy_still_accepts_the_key_in_its_listing(rig):
    rig.env_ls.write_text(PROD_KEY)
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1")
    assert code == 0, out
    assert rig.deployed() == []


def test_prod_paused_release_check_fails_when_the_deploy_reports_an_active_key(rig, site):
    sha = rig.head()
    base = _alias(rig, site(_pages(sha)))  # health says youcam=true
    code, out = rig.run("deploy-prod.sh", "--paused", PROD_URL=base)
    assert code == 1, out
    assert "health: youcam is true on a deploy that must hold no key" in out
    assert out.splitlines()[-1].startswith("Deployed, but the release check failed")


def test_prod_alias_mismatch_is_exit_3_not_a_rollback_trigger(rig, site):
    rig.inspect_out.write_text("    Aliases     https://something-else.vercel.app\n")
    code, out = rig.run("deploy-prod.sh", PROD_URL=site(_pages(rig.head())))
    assert code == 3, out
    assert "do not roll back" in out and "release" not in out.splitlines()[-1].split()[:1]


def test_prod_release_failure_is_exit_1_and_names_the_rollback(rig, site):
    base = _alias(rig, site(_pages(rig.head(), **{"/evidence": [(500, "")]})))
    code, out = rig.run("deploy-prod.sh", PROD_URL=base, RELEASE_ATTEMPTS="1")
    assert code == 1, out
    assert out.splitlines()[-1].startswith("Deployed, but the release check failed")
    assert "evidence: status 500" in out


def test_prod_401_at_the_release_check_is_exit_4_and_not_a_rollback_trigger(rig, site):
    base = _alias(rig, site(_pages(rig.head(), **{"/": [(401, "")]})))
    code, out = rig.run("deploy-prod.sh", PROD_URL=base)
    assert code == 4, out
    assert "Vercel Authentication" in out and "not a release failure" in out
    assert "Deployed, but the release check failed" not in out


def test_prod_unreachable_release_check_is_exit_4_with_no_rollback_line(rig):
    # Codex r2 finding G: the operator's network failing proves nothing about the release. One
    # attempt (RELEASE_ATTEMPTS) keeps the test from sleeping 50 s between six real ones.
    _alias(rig, "http://127.0.0.1:9")
    code, out = rig.run("deploy-prod.sh", PROD_URL="http://127.0.0.1:9", RELEASE_ATTEMPTS="1")
    assert code == 4, out
    assert "html: unreachable (" in out and "not a release failure" in out
    assert "rollback" not in out.lower() and "Deployed, but the release check failed" not in out
    assert "Vercel Authentication answers 401" not in out


def test_prod_post_deploy_failures_are_exit_4_with_a_serving_line(rig, site):
    sha = rig.head()
    base = _alias(rig, site(_pages(sha)))
    cases = [
        {"FAKE_DEPLOY_FAIL": "1"},
        {"FAKE_INSPECT_FAIL": "1"},
    ]
    for extra in cases:
        code, out = rig.run("deploy-prod.sh", PROD_URL=base, **extra)
        assert code == 4, (extra, out)
        assert "UNVERIFIED" in out and out.count(f"serving {sha}") >= 2, out
    rig.deploy_out.write_text("Error: something odd\n")
    code, out = rig.run("deploy-prod.sh", PROD_URL=base)
    assert code == 4 and "UNVERIFIED" in out, out


def _track_branch(rig):
    _git(rig.work, "checkout", "-q", "-b", "feature")
    _git(rig.work, "push", "-q", "-u", "origin", "feature")


def test_preview_refuses_an_unpushed_head(rig):
    _track_branch(rig)
    (rig.work / "f.txt").write_text("x")
    _git(rig.work, "add", "f.txt")
    _git(rig.work, "commit", "-q", "-m", "unpushed")
    code, out = rig.run("deploy-preview.sh")
    assert code == 1 and "deployment:" not in out
    assert rig.deployed() == []


def test_preview_refuses_red_ci_and_the_scan_flag(rig):
    _track_branch(rig)
    rig.set_ci(("test", "success"), ("web", "failure"))
    assert rig.run("deploy-preview.sh")[0] == 1
    rig.set_ci(("test", "success"), ("web", "success"))
    rig.env_ls.write_text(SOME_VARS + " SCAN_ENABLED  Encrypted  Preview  1m ago\n")
    code, out = rig.run("deploy-preview.sh")
    assert code == 1 and "SCAN_ENABLED" in out
    rig.env_ls.write_text(NO_VARS)
    code, out = rig.run("deploy-preview.sh", SCAN_ENABLED="1")
    assert code == 1 and "SCAN_ENABLED" in out
    assert any(c.startswith("env ls preview") for c in rig.calls())
    assert rig.deployed() == []


def _keyless(sha):
    return _pages(sha, **{"/api/health": [(200, {**HEALTH, "release": sha, "youcam": False})]})


def test_preview_refuses_before_deploying_when_the_preview_environment_lists_the_key(rig):
    # Codex r1 finding C: presence of the name fails; a failed listing fails closed.
    _track_branch(rig)
    rig.env_ls.write_text(WITH_KEY)
    code, out = rig.run("deploy-preview.sh")
    assert code == 1 and "YOUCAM_API_KEY" in out and "deployment:" not in out, out
    code, out = rig.run("deploy-preview.sh", DRY_RUN="1")
    assert code == 1 and "DRY_RUN=1" not in out, out
    rig.env_ls.write_text(NO_VARS)
    code, out = rig.run("deploy-preview.sh", FAKE_ENV_FAIL="1")
    assert code == 1 and "deployment:" not in out, out
    assert rig.deployed() == []


def test_preview_release_check_fails_when_the_deploy_reports_an_active_key(rig, site):
    _track_branch(rig)
    sha = rig.head()
    rig.deploy_out.write_text(site(_pages(sha)) + "\n")  # health says youcam=true
    code, out = rig.run("deploy-preview.sh")
    assert code == 1, out
    assert out.splitlines()[-1] == "health: youcam is true on a deploy that must hold no key"


def test_preview_deploys_verifies_and_keeps_its_build_log(rig, site):
    _track_branch(rig)
    sha = rig.head()
    rig.deploy_out.write_text(site(_keyless(sha)) + "\n")
    rig.inspect_out.write_text("Node.js Version 22.x\npnpm 12.3.4\n")
    code, out = rig.run("deploy-preview.sh")
    assert code == 0, out
    assert out.splitlines()[-1].startswith(f"release {sha} ok: html, health (youcam=false")
    assert "Node.js Version 22.x" in out
    assert any(c.startswith("deploy ") and "--prod" not in c for c in rig.calls())
    log = rig.work / "web" / ".vercel" / "preview-build.log"
    assert "pnpm 12.3.4" in log.read_text()
    assert str(log.relative_to(rig.work / "web")) in out


def test_preview_release_failure_and_401_are_not_green(rig, site):
    _track_branch(rig)
    sha = rig.head()
    rig.deploy_out.write_text(site(_pages(sha, **{"/": [(401, "")]})) + "\n")
    code, out = rig.run("deploy-preview.sh")
    assert code == 4 and "Vercel Authentication" in out, out
    rig.deploy_out.write_text("Error: nothing\n")
    code, out = rig.run("deploy-preview.sh")
    assert code != 0 and "release" not in out.splitlines()[-1][:8]

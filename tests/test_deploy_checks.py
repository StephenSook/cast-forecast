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
    assert dc.health_ok({**good, "youcam": False}, "abc", require_youcam=False) == (True, "ok")
    assert dc.health_ok({**good, "session": False}, "abc") == (
        False,
        "session secret not configured",
    )
    assert dc.health_ok({**good, "release": "abd"}, "abc") == (False, "release abd, want abc")
    assert dc.health_ok({**good, "node": "24.1.0"}, "abc") == (False, "node 24.1.0, want 22.x")


def test_evidence_needs_the_k1b_pass_row():
    assert dc.evidence_ok(
        "<table><tr><td>K1b</td><td>Same question</td><td>PASS 5 of 5</td></tr></table>"
    )
    assert not dc.evidence_ok(
        "<table><tr><td>K1b</td><td>FAIL</td></tr><tr><td>K2</td><td>PASS</td></tr></table>"
    )
    assert not dc.evidence_ok("<p>Evidence</p>")


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


SHA = "abc1234"
HEALTH = {"release": SHA, "youcam": True, "session": True, "node": "22.23.2"}
PAGES = {
    "/": [(200, f'<head><meta name="cf-release" content="{SHA}"/></head>')],
    "/api/health": [(200, HEALTH)],
    "/evidence": [(200, "<table><tr><td>K1b</td><td>PASS 5 of 5</td></tr></table>")],
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
    assert dc.release_check(site(), SHA, sleep=sleeps.append) == (True, OK_LINE)
    assert sleeps == []


def test_release_retries_until_one_attempt_passes_all_four(site):
    sleeps = []
    base = site({"/api/health": [(200, {**HEALTH, "release": "old"}), (200, HEALTH)]})
    assert dc.release_check(base, SHA, sleep=sleeps.append) == (True, OK_LINE)
    assert sleeps == [10]


def test_release_gives_up_after_the_last_attempt(site):
    sleeps = []
    base = site({"/evidence": [(500, "")]})
    got = dc.release_check(base, SHA, attempts=3, sleep=sleeps.append)
    assert got == (False, "evidence: status 500")
    assert sleeps == [10, 10]


def test_release_stops_at_once_on_401(site):
    sleeps = []
    got = dc.release_check(site({"/": [(401, "")]}), SHA, sleep=sleeps.append)
    assert got == (False, "deployment is behind Vercel Authentication (401)")
    assert sleeps == []


def test_release_requires_youcam_unless_allowed(site):
    base = site({"/api/health": [(200, {**HEALTH, "youcam": False})]})
    assert dc.release_check(base, SHA, attempts=1) == (False, "health: youcam not configured")
    got = dc.release_check(base, SHA, require_youcam=False, attempts=1)
    assert got == (True, OK_LINE.replace("youcam=true", "youcam=false"))


def test_release_names_the_failing_inverse_check(site):
    bad = {"k1b": {"inverseCheck": [{"match": True}, {"match": False}]}}
    base = site({"/api/gates": [(200, bad)]})
    assert dc.release_check(base, SHA, attempts=1) == (
        False,
        "gates: inverse check 2 does not match",
    )


def test_release_unreachable_and_wrong_sha_and_no_evidence_row(site):
    got = dc.release_check("http://127.0.0.1:9", SHA, attempts=1)
    assert got[0] is False and got[1].startswith("html: unreachable (")
    other = site({"/": [(200, '<meta name="cf-release" content="zzz"/>')]})
    assert dc.release_check(other, SHA, attempts=1) == (False, f"html: cf-release is not {SHA}")
    noev = site({"/evidence": [(200, "<p>Evidence</p>")]})
    assert dc.release_check(noev, SHA, attempts=1) == (False, "evidence: no K1b PASS row")


def test_main_release_and_serving(site, capsys):
    base = site()
    assert dc.main(["release", base, SHA]) == 0
    assert dc.main(["serving", base]) == 0
    assert capsys.readouterr().out.splitlines() == [OK_LINE, f"serving {SHA}"]
    assert dc.main(["serving", "http://127.0.0.1:9"]) == 0
    assert capsys.readouterr().out.startswith("serving none (")
    assert dc.main(["release"]) == 2


# ---- the deploy scripts themselves, run against a throwaway repo with fake gh and vercel ----

FAKE_VERCEL = """#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
if [ "$1" = "env" ] && [ "$2" = "ls" ]; then
  if [ -n "${FAKE_ENV_FAIL:-}" ]; then echo "Error: not logged in"; exit 1; fi
  cat "$FAKE_ENV_LS"; exit 0
fi
echo "unexpected vercel call: $*"; exit 99
"""
FAKE_GH = """#!/usr/bin/env bash
echo "gh $*" >> "$FAKE_LOG"
if [ -n "${FAKE_GH_FAIL:-}" ]; then exit 1; fi
cat "$FAKE_CI"
"""
GOOD_PROJECT = {
    "projectName": "cast-forecast-web",
    "projectId": "prj_13eXRfxiEveDWgUuyKar6XOzl4Lm",
    "orgId": "team_x",
}


def _git(cwd, *args):
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
    )


class Rig:
    def __init__(self, tmp_path):
        self.tmp = tmp_path
        origin = tmp_path / "origin.git"
        self.work = tmp_path / "work"
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
        self.work.mkdir()
        _git(self.work, "init", "-q", "-b", "main")
        (self.work / "web" / "scripts").mkdir(parents=True)
        for name in ("deploy_checks.py", "deploy-prod.sh", "deploy-preview.sh"):
            shutil.copy(SCRIPTS / name, self.work / "web" / "scripts" / name)
        (self.work / ".gitignore").write_text(".vercel/\n.env.*\n__pycache__/\n")
        (self.work / "web" / ".vercel").mkdir()
        (self.work / "web" / ".vercel" / "project.json").write_text(json.dumps(GOOD_PROJECT))
        _git(self.work, "add", ".")
        _git(self.work, "commit", "-q", "-m", "init")
        _git(self.work, "remote", "add", "origin", str(origin))
        _git(self.work, "push", "-q", "-u", "origin", "main")
        self.bin = tmp_path / "bin"
        self.bin.mkdir()
        for name, body in (("vercel", FAKE_VERCEL), ("gh", FAKE_GH)):
            (self.bin / name).write_text(body)
            (self.bin / name).chmod(0o755)
        self.log = tmp_path / "calls.log"
        self.log.write_text("")
        self.env_ls = tmp_path / "env_ls.txt"
        self.env_ls.write_text(NO_VARS)
        self.ci = tmp_path / "ci.json"
        self.set_ci(("test", "success"), ("web", "success"))

    def set_ci(self, *pairs):
        self.ci.write_text(json.dumps(runs(*pairs)))

    def run(self, script, *args, **extra):
        env = {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "VERCEL_CMD": str(self.bin / "vercel"),
            "FAKE_LOG": str(self.log),
            "FAKE_CI": str(self.ci),
            "FAKE_ENV_LS": str(self.env_ls),
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        env.pop("SCAN_ENABLED", None)
        env.pop("DRY_RUN", None)
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


@pytest.fixture
def rig(tmp_path):
    return Rig(tmp_path)


def _no_deploy(rig):
    assert not [c for c in rig.calls() if c.startswith(("deploy", "promote", "rollback", "alias"))]


def test_prod_dry_run_passes_every_gate_and_deploys_nothing(rig):
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1")
    assert code == 0, out
    assert out.splitlines()[-1] == "DRY_RUN=1: gates passed, nothing deployed"
    assert "deployment:" not in out
    _no_deploy(rig)
    assert any(c.startswith("env ls production") for c in rig.calls())


def test_prod_refuses_a_branch_head(rig):
    _git(rig.work, "checkout", "-q", "-b", "feature")
    (rig.work / "f.txt").write_text("x")
    _git(rig.work, "add", "f.txt")
    _git(rig.work, "commit", "-q", "-m", "feature work")
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1")
    assert code == 1
    assert out.splitlines()[-1] == "HEAD is not origin/main"
    assert "deployment:" not in out
    _no_deploy(rig)


def test_prod_refuses_a_dirty_tree(rig):
    (rig.work / "web" / "stray.txt").write_text("x")
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1")
    assert code == 1 and "deployment:" not in out
    _no_deploy(rig)


def test_prod_refuses_an_unlinked_or_wrong_project(rig):
    project = rig.work / "web" / ".vercel" / "project.json"
    project.write_text(json.dumps({"projectName": "web", "projectId": "prj_other"}))
    assert rig.run("deploy-prod.sh", DRY_RUN="1")[0] == 1
    project.unlink()
    assert rig.run("deploy-prod.sh", DRY_RUN="1")[0] == 1
    _no_deploy(rig)


def test_prod_refuses_an_ignored_file_that_would_ship(rig):
    (rig.work / ".gitignore").write_text(".vercel/\n.env.*\n__pycache__/\n*.jpg\n")
    _git(rig.work, "add", ".gitignore")
    _git(rig.work, "commit", "-q", "-m", "ignore jpg")
    _git(rig.work, "push", "-q", "origin", "main")
    (rig.work / "web" / "selfie.jpg").write_text("x")
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1")
    assert code == 1 and "ignored path would ship: web/selfie.jpg" in out
    _no_deploy(rig)


def test_prod_refuses_red_missing_or_unreadable_ci(rig):
    rig.set_ci(("test", "success"), ("web", "failure"))
    assert rig.run("deploy-prod.sh", DRY_RUN="1")[0] == 1
    rig.set_ci(("test", "success"))
    assert rig.run("deploy-prod.sh", DRY_RUN="1")[0] == 1
    rig.set_ci()
    assert rig.run("deploy-prod.sh", DRY_RUN="1")[0] == 1
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1", FAKE_GH_FAIL="1")
    assert code == 1 and "DRY_RUN=1" not in out
    _no_deploy(rig)


def test_prod_refuses_when_the_scan_flag_is_set_anywhere(rig):
    rig.env_ls.write_text(SOME_VARS + " SCAN_ENABLED  Encrypted  Production  1m ago\n")
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1")
    assert code == 1 and "SCAN_ENABLED" in out and "DRY_RUN=1" not in out
    rig.env_ls.write_text(NO_VARS)
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1", SCAN_ENABLED="1")
    assert code == 1 and "SCAN_ENABLED" in out and "DRY_RUN=1" not in out
    code, _ = rig.run("deploy-prod.sh", DRY_RUN="1", SCAN_ENABLED="0")
    assert code == 0
    _no_deploy(rig)


def test_prod_refuses_when_the_env_listing_fails(rig):
    code, out = rig.run("deploy-prod.sh", DRY_RUN="1", FAKE_ENV_FAIL="1")
    assert code == 1 and "DRY_RUN=1" not in out
    _no_deploy(rig)


def test_prod_rejects_unknown_arguments(rig):
    assert rig.run("deploy-prod.sh", "--nope", DRY_RUN="1")[0] == 2
    _no_deploy(rig)


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
    _no_deploy(rig)


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
    _no_deploy(rig)

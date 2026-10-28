import copy
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TASK = "tgqyy0mDdd-11fk3D-AGXwz_P0qHVOlbpBINyIkMtXPUmXXPT3KseFWRMzhhCd8qqFMyIC7kPRXZZ"
FILE = "w+wtWqusYvxlX5NmcpOwnIlmP1zuzPLm585u63loqkl/C8eww3w0SPDfASxcJfYq"


def _load():
    spec = importlib.util.spec_from_file_location(
        "publish_results", ROOT / "scripts" / "publish_results.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pr = _load()


def _run_record():
    return {
        "selfie_a": "A.jpg",
        "selfie_b": "B.jpg",
        "file_ids": {"A": FILE, "B": FILE},
        "balance_before": 898,
        "preflight": {
            "A": {"bytes": 1216474, "hd": True, "height": 2625, "ok": True, "reasons": []},
            "B": {"bytes": 1407228, "short_side": 1775, "width": 1775, "ok": True, "reasons": []},
        },
        "renders": [
            {
                "id": "A_FFFFFF_ci0_cov0",
                "selfie": "A",
                "task_id": TASK,
                "result_url": "https://cdn.example/x.png?X-Amz-Signature=abc",
                "lab_mean": [70.25804340942419, 17.5, 22.2],
                "file": "A_FFFFFF_ci0_cov0.png",
            }
        ],
        "error": {
            "code": "error_exceed_max_image_size",
            "task_id": TASK,
            "message": f"task {TASK} failed: error_exceed_max_image_size",
        },
        "contact_sheet_error": "cannot write '/Users/someone/private_inputs/k1_contact.jpg'",
        "copy_path": "/Users/someone/private_inputs/upload_copies/A.upload.jpg",
        "note": "render at https://cdn.example/r/x.png?sig=abc expired",
        "g100": 0.3545024830997824,
    }


def test_denylisted_fields_are_removed_and_numbers_kept():
    run = _run_record()
    original = copy.deepcopy(run)
    clean, removed = pr.sanitize(run)
    assert run == original  # input untouched
    for key in ("selfie_a", "selfie_b", "file_ids", "copy_path"):
        assert key not in clean
    r0 = clean["renders"][0]
    assert "task_id" not in r0 and "result_url" not in r0
    assert r0["selfie"] == "A" and r0["file"] == "A_FFFFFF_ci0_cov0.png"  # labels stay
    assert r0["lab_mean"] == [70.25804340942419, 17.5, 22.2]
    assert clean["g100"] == 0.3545024830997824 and clean["balance_before"] == 898
    assert clean["preflight"] == {
        "A": {"hd": True, "ok": True, "reasons": []},
        "B": {"ok": True, "reasons": []},
    }
    assert "/renders[0]/task_id" in removed and "/preflight/A/bytes" in removed


def test_ids_and_paths_inside_text_are_redacted():
    clean, _ = pr.sanitize(_run_record())
    assert clean["error"] == {
        "code": "error_exceed_max_image_size",
        "message": "task [id removed] failed: error_exceed_max_image_size",
    }
    assert clean["contact_sheet_error"] == "cannot write '[path removed]'"
    assert clean["note"] == "render at [url removed] expired"
    assert pr.forbidden_hits(pr.dumps(clean)) == []


def test_flat_preflight_and_top_level_selfie():
    clean, _ = pr.sanitize(
        {
            "selfie": "A.jpg",
            "preflight": {"bytes": 1, "width": 2, "height": 3, "short_side": 2, "ok": True},
            "calls": [{"file_id": FILE, "task_id": TASK, "skin_color": "#a17758"}],
        }
    )
    assert clean == {"preflight": {"ok": True}, "calls": [{"skin_color": "#a17758"}]}


def test_planted_forbidden_patterns_are_detected():
    for text in (
        '{"task_id": 1}',
        '{"x": "file_id"}',
        "https://a.example",
        "/Users/me",
        "private_inputs",
        "X-Amz-Credential",
        "sig=abc",
        "A" * 40,
    ):
        assert pr.forbidden_hits(text), text
    assert pr.forbidden_hits('{"id": "A_FFFFFF_ci100_cov100", "g": 0.355}') == []


def test_main_refuses_to_write_when_a_pattern_survives(tmp_path):
    src = tmp_path / "run.json"
    src.write_text(json.dumps({"note": "sig=abc", "ok": True}))
    dest = tmp_path / "out" / "published.json"
    assert pr.main([str(src), str(dest)]) == 1
    assert not dest.exists()


def test_main_writes_sorted_indented_json(tmp_path):
    src = tmp_path / "run.json"
    src.write_text(json.dumps(_run_record()))
    dest = tmp_path / "published.json"
    assert pr.main([str(src), str(dest)]) == 0
    text = dest.read_text()
    assert text == pr.dumps(json.loads(text)) and text.endswith("}\n")

import json
from pathlib import Path

import pytest

from castforecast.youcam import Request, Response, YouCamClient, YouCamError

KEY = "SECRET-KEY-123"


class Fake:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls: list[Request] = []

    def __call__(self, req: Request) -> Response:
        self.calls.append(req)
        return self.responses.pop(0)


def ok(data, status=200):
    return Response(status, json.dumps({"status": 200, "data": data}).encode())


def client(responses, **kw):
    fake = Fake(responses)
    sleeps: list[float] = []
    c = YouCamClient(transport=fake, key=KEY, sleep=sleeps.append, **kw)
    return c, fake, sleeps


def test_upload_uses_returned_request_exactly(tmp_path: Path):
    f = tmp_path / "a.jpg"
    f.write_bytes(b"JPEGDATA")
    hdrs = {"Content-Type": "image/jpeg", "x-amz-foo": "Bar=="}
    c, fake, _ = client(
        [
            ok(
                {
                    "files": [
                        {
                            "file_id": "fid1",
                            "requests": [
                                {
                                    "url": "https://up.example/x?sig=AbC%2F",
                                    "method": "PUT",
                                    "headers": hdrs,
                                }
                            ],
                        }
                    ]
                }
            ),
            Response(200, b""),
        ]
    )
    assert c.upload(f) == "fid1"
    reg, put = fake.calls
    assert reg.url.endswith("/s2s/v2.0/file") and reg.method == "POST"
    assert json.loads(reg.body)["files"][0]["file_size"] == 8
    assert put.url == "https://up.example/x?sig=AbC%2F"
    assert put.method == "PUT"
    assert put.headers == hdrs
    assert put.body == b"JPEGDATA"


def test_poll_returns_results_on_success():
    c, fake, sleeps = client(
        [
            ok({"task_status": "running"}),
            ok({"task_status": "success", "results": {"url": "https://r/x.jpg"}}),
        ]
    )
    assert c.poll("task/makeup-vto", "t1") == {"url": "https://r/x.jpg"}
    assert fake.calls[0].url.endswith("/s2s/v2.0/task/makeup-vto/t1")
    assert sleeps == [2]


def test_poll_raises_with_code_on_error():
    c, fake, _ = client([ok({"task_status": "error", "error": "error_src_face_too_small"})])
    with pytest.raises(YouCamError) as e:
        c.poll("task/skin-tone-analysis", "t9")
    assert e.value.code == "error_src_face_too_small"
    assert e.value.task_id == "t9"
    assert len(fake.calls) == 1


def test_poll_times_out_with_task_id():
    clock = iter(range(0, 1000, 2))
    fake = Fake([ok({"task_status": "running"})] * 100)
    c = YouCamClient(transport=fake, key=KEY, sleep=lambda s: None, clock=lambda: next(clock))
    with pytest.raises(YouCamError) as e:
        c.poll("task/makeup-vto", "tslow", timeout_s=10)
    assert e.value.task_id == "tslow"
    assert e.value.code == "timeout"


@pytest.mark.parametrize("key", ["", None])
def test_empty_key_refused_before_any_request(key, monkeypatch):
    monkeypatch.setattr("castforecast.youcam.read_key", lambda: "")
    fake = Fake([])
    with pytest.raises(YouCamError, match="no key"):
        YouCamClient(transport=fake, key=key).balance()
    assert fake.calls == []


def test_key_never_in_repr_or_errors():
    c, _, _ = client([Response(500, f"boom {KEY}".encode())])
    assert KEY not in repr(c) and KEY not in str(c)
    with pytest.raises(YouCamError) as e:
        c.balance()
    assert KEY not in str(e.value) and KEY not in repr(e.value)


def test_429_backs_off_once_then_raises():
    c, fake, sleeps = client([Response(429, b""), Response(429, b"")])
    with pytest.raises(YouCamError) as e:
        c.balance()
    assert e.value.code == "http_429"
    assert sleeps == [30]
    assert len(fake.calls) == 2


def test_429_then_success_and_balance_parse():
    c, fake, sleeps = client([Response(429, b""), ok({"total_credits": 987})])
    assert c.balance() == 987
    assert sleeps == [30]
    assert fake.calls[0].headers["Authorization"] == f"Bearer {KEY}"

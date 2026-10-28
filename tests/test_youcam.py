import http.client
import json
import subprocess
import traceback
from pathlib import Path
from typing import ClassVar

import pytest

import castforecast.youcam as yc
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


# ---- fix round 1 ----


class FakeConn:
    instances: ClassVar[list["FakeConn"]] = []
    status = 200
    body = b"{}"
    read_exc: Exception | None = None

    def __init__(self, host, timeout=None, **kw):
        self.host = host
        self.line = None
        self.headers: list[tuple[str, str]] = []
        self.sent_body = None
        FakeConn.instances.append(self)

    def putrequest(self, method, url, **kw):
        self.line = (method, url, kw)

    def putheader(self, name, value):
        self.headers.append((name, value))

    def endheaders(self, body=None):
        self.sent_body = body

    def getresponse(self):
        conn = self

        class R:
            status = conn.status

            def read(self):
                if conn.read_exc:
                    raise conn.read_exc
                return conn.body

        return R()

    def close(self):
        pass


@pytest.fixture
def conn(monkeypatch):
    FakeConn.instances = []
    FakeConn.status, FakeConn.body, FakeConn.read_exc = 200, b"{}", None
    monkeypatch.setattr(yc.http.client, "HTTPSConnection", FakeConn)
    return FakeConn


def test_real_transport_sends_exactly_returned_headers(conn):
    hdrs = {"content-type": "image/jpeg", "x-amz-Foo": "Bar=="}
    resp = yc._http_transport(
        Request("PUT", "https://up.example/a/b?sig=AbC%2F&x=1", hdrs, b"DATA")
    )
    c = conn.instances[0]
    assert resp.status == 200
    assert c.host == "up.example"
    method, target, kw = c.line
    assert (method, target) == ("PUT", "/a/b?sig=AbC%2F&x=1")
    assert kw.get("skip_accept_encoding") is True
    assert c.headers == [*hdrs.items(), ("Content-Length", "4")]
    assert c.sent_body == b"DATA"


def test_real_transport_no_body_adds_no_content_headers(conn):
    yc._http_transport(Request("GET", "https://r.example/x.jpg", {}, None))
    assert conn.instances[0].headers == []


@pytest.mark.parametrize(
    "exc", [TimeoutError(), ConnectionResetError(), http.client.IncompleteRead(b"x")]
)
def test_real_transport_wraps_read_errors(conn, exc):
    conn.read_exc = exc
    with pytest.raises(YouCamError) as e:
        yc._http_transport(Request("GET", "https://r.example/x"))
    assert e.value.code == "network"


def test_redirect_is_not_followed_and_is_loud(conn):
    conn.status = 302
    c = YouCamClient(key=KEY)
    with pytest.raises(YouCamError) as e:
        c.balance()
    assert e.value.code == "http_302"
    assert len(conn.instances) == 1
    assert KEY not in str(e.value)


def test_read_key_blank_stdout_with_exit_zero(monkeypatch):
    monkeypatch.setattr(
        subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, b"\n", b"")
    )
    with pytest.raises(YouCamError, match="no key"):
        yc.read_key()


def test_read_key_nonzero_and_missing_binary(monkeypatch):
    monkeypatch.setattr(
        subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 44, b"x", b"")
    )
    with pytest.raises(YouCamError, match="no key"):
        yc.read_key()

    def boom(*a, **k):
        raise FileNotFoundError("security")

    monkeypatch.setattr(subprocess, "run", boom)
    with pytest.raises(YouCamError, match="no key"):
        yc.read_key()


def test_read_key_returns_value(monkeypatch):
    monkeypatch.setattr(
        subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, b"abc\n", b"")
    )
    assert yc.read_key() == "abc"


def test_request_repr_never_contains_key():
    r = Request("GET", "https://x", {"Authorization": f"Bearer {KEY}"}, b"body")
    assert KEY not in repr(r)


def test_require_budget_both_paths():
    c, _, _ = client([ok({"total_credits": 150})])
    with pytest.raises(YouCamError) as e:
        c.require_budget()
    assert e.value.code == "budget"
    c, _, _ = client([ok({"total_credits": 640})])
    assert c.require_budget() == 640
    c, _, _ = client([ok({"total_credits": 50})])
    assert c.require_budget(min_units=10) == 50


def test_poll_success_with_empty_results_is_bad_shape():
    c, _, _ = client([ok({"task_status": "success", "results": {}})])
    with pytest.raises(YouCamError) as e:
        c.poll("task/makeup-vto", "t2")
    assert e.value.code == "bad_shape" and e.value.task_id == "t2"


# ---- keys that http.client would echo in its own error messages ----

BAD_KEYS = ["SECRET\rX", "SECRET\nX", "SECRET\x00X", "SECRET☃X"]


def _assert_no_secret(exc: BaseException) -> None:
    assert "SECRET" not in str(exc) and "SECRET" not in repr(exc)
    assert "SECRET" not in "".join(traceback.format_exception(exc))
    assert exc.__context__ is None and exc.__cause__ is None


def _no_network(self):
    raise OSError("network disabled in tests")


@pytest.mark.parametrize("bad", ["SECRET\rX", "SECRET\nX", "SECRET☃X"])
def test_transport_header_error_never_echoes_value(bad, monkeypatch):
    # A real HTTPSConnection: http.client validates and encodes header values in putheader,
    # before any connection is opened, and its own messages quote the full value.
    monkeypatch.setattr(http.client.HTTPSConnection, "connect", _no_network)
    req = Request("GET", "https://yce-api-01.makeupar.com/x", {"Authorization": f"Bearer {bad}"})
    with pytest.raises(YouCamError) as e:
        yc._http_transport(req)
    assert e.value.code == "bad_request"
    _assert_no_secret(e.value)


@pytest.mark.parametrize("bad", BAD_KEYS)
def test_client_refuses_non_printable_key_without_echo(bad):
    fake = Fake([])
    with pytest.raises(YouCamError) as e:
        YouCamClient(transport=fake, key=bad)
    assert e.value.code == "bad_key"
    _assert_no_secret(e.value)
    assert fake.calls == []


@pytest.mark.parametrize(
    "raw", [b"SECRET\rX\n", b"SECRET\x00X", b"SECRET\xe2\x98\x83X", b"SECRET\xffX"]
)
def test_read_key_refuses_non_printable_without_echo(raw, monkeypatch):
    monkeypatch.setattr(
        subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, raw, b"")
    )
    with pytest.raises(YouCamError) as e:
        yc.read_key()
    assert e.value.code == "bad_key"
    _assert_no_secret(e.value)


def test_printable_key_with_symbols_is_accepted_and_sent():
    key = "aB3+/=_-.~"
    fake = Fake([ok({"total_credits": 5})])
    c = YouCamClient(transport=fake, key=key, sleep=lambda s: None)
    assert c.balance() == 5
    assert fake.calls[0].headers["Authorization"] == f"Bearer {key}"

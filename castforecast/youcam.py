"""Minimal YouCam S2S client. stdlib only; the API key never leaves this module."""

from __future__ import annotations

import http.client
import json
import subprocess
import time
import urllib.parse
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

BASE = "https://yce-api-01.makeupar.com"
RATE_LIMIT = 250
RATE_WINDOW_S = 300
POLL_INTERVAL_S = 2
BACKOFF_429_S = 30


class YouCamError(Exception):
    def __init__(self, message: str, code: str | None = None, task_id: str | None = None):
        super().__init__(message)
        self.code = code
        self.task_id = task_id


@dataclass
class Request:
    method: str
    url: str
    headers: dict[str, str] = field(default_factory=dict, repr=False)
    body: bytes | None = field(default=None, repr=False)


@dataclass
class Response:
    status: int
    body: bytes = b""


def _printable_ascii(key: str) -> bool:
    return all(" " <= ch <= "~" for ch in key)


def _bad_key() -> YouCamError:
    # Never echo the value: http.client and codec errors quote the whole header value.
    return YouCamError("key contains characters outside printable ASCII", code="bad_key")


def read_key() -> str:
    try:
        out = subprocess.run(
            ["security", "find-generic-password", "-s", "youcam-api-key", "-w"],
            capture_output=True,
            check=False,
        )
    except OSError:
        raise YouCamError("no key") from None
    key = out.stdout.decode("utf-8", errors="replace").strip()
    if out.returncode != 0 or not key:
        raise YouCamError("no key")
    if not _printable_ascii(key):
        raise _bad_key()
    return key


def _http_transport(req: Request) -> Response:
    """Send via http.client so the wire request is exactly the one described.

    No redirects are followed (a 3xx comes back as a status), no default headers are
    added beyond Host and Content-Length framing, and header case is preserved.
    """
    parts = urllib.parse.urlsplit(req.url)
    target = parts.path or "/"
    if parts.query:
        target += "?" + parts.query
    conn_cls = http.client.HTTPConnection if parts.scheme == "http" else http.client.HTTPSConnection
    conn = conn_cls(parts.netloc, timeout=60)
    try:
        conn.putrequest(req.method, target, skip_accept_encoding=True)
        bad_header = False
        try:
            for name, value in req.headers.items():
                conn.putheader(name, value)
        except (ValueError, UnicodeError):
            # http.client quotes the full header value in these messages (the Bearer key).
            bad_header = True
        if bad_header:  # raised outside the except block so no __context__ keeps the value
            raise YouCamError("invalid request header", code="bad_request")
        if req.body is not None:
            conn.putheader("Content-Length", str(len(req.body)))
        conn.endheaders(req.body)
        resp = conn.getresponse()
        return Response(resp.status, resp.read())
    except (OSError, http.client.HTTPException) as e:
        raise YouCamError(f"network error: {type(e).__name__}", code="network") from None
    finally:
        conn.close()


class YouCamClient:
    def __init__(
        self,
        transport: Callable[[Request], Response] | None = None,
        key: str | None = None,
        *,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._transport = transport or _http_transport
        self._key = read_key() if key is None else key
        if self._key and not _printable_ascii(self._key):
            raise _bad_key()
        self._sleep = sleep
        self._clock = clock
        self._sent: deque[float] = deque()

    def __repr__(self) -> str:
        return "YouCamClient()"

    def _send(self, req: Request) -> Response:
        if not self._key:
            raise YouCamError("no key")
        for attempt in (0, 1):
            self._throttle()
            resp = self._transport(req)
            if resp.status != 429:
                return resp
            if attempt == 0:
                self._sleep(BACKOFF_429_S)
        raise YouCamError("rate limited (HTTP 429) after one backoff", code="http_429")

    def _throttle(self) -> None:
        now = self._clock()
        while self._sent and now - self._sent[0] >= RATE_WINDOW_S:
            self._sent.popleft()
        if len(self._sent) >= RATE_LIMIT:
            self._sleep(RATE_WINDOW_S - (now - self._sent[0]))
        self._sent.append(self._clock())

    def _api(self, method: str, path: str, payload: dict | None = None) -> dict:
        headers = {"Authorization": f"Bearer {self._key}"}
        body = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(payload).encode()
        resp = self._send(Request(method, BASE + path, headers, body))
        if resp.status >= 300:
            code = f"http_{resp.status}"
            raise YouCamError(f"{method} {path} failed with HTTP {resp.status}", code=code)
        try:
            return json.loads(resp.body)
        except ValueError:
            raise YouCamError(f"{method} {path} returned non-JSON", code="bad_json") from None

    def balance(self) -> int:
        body = self._api("GET", "/s2s/v1.0/client/credit")
        total = _sum_credits(body.get("results", body.get("data")))
        if total is None:
            raise YouCamError("credit response had no recognisable balance", code="bad_shape")
        return total

    def require_budget(self, min_units: int = 200) -> int:
        bal = self.balance()
        if bal < min_units:
            raise YouCamError(f"budget: balance {bal} is under {min_units}", code="budget")
        return bal

    def upload(self, path: Path) -> str:
        path = Path(path)
        data = path.read_bytes()
        ctype = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
        body = self._api(
            "POST",
            "/s2s/v2.0/file",
            {"files": [{"content_type": ctype, "file_name": path.name, "file_size": len(data)}]},
        )
        try:
            entry = body["data"]["files"][0]
            spec = entry["requests"][0]
            file_id = entry["file_id"]
            url, method, headers = spec["url"], spec["method"], dict(spec["headers"])
        except (KeyError, IndexError, TypeError):
            raise YouCamError(
                "upload registration had unexpected shape", code="bad_shape"
            ) from None
        resp = self._send_raw(Request(method, url, headers, data))
        if resp.status >= 300:
            raise YouCamError(
                f"upload PUT failed with HTTP {resp.status}", code=f"http_{resp.status}"
            )
        return file_id

    def _send_raw(self, req: Request) -> Response:
        """Send to a pre-signed URL: no Authorization header, request used as returned."""
        return self._send(req)

    def run(self, endpoint: str, payload: dict) -> str:
        body = self._api("POST", f"/s2s/v2.0/{endpoint.strip('/')}", payload)
        try:
            return body["data"]["task_id"]
        except (KeyError, TypeError):
            raise YouCamError("task start had no task_id", code="bad_shape") from None

    def poll(self, endpoint: str, task_id: str, timeout_s: float = 120) -> dict:
        deadline = self._clock() + timeout_s
        path = f"/s2s/v2.0/{endpoint.strip('/')}/{task_id}"
        while True:
            data = self._api("GET", path).get("data") or {}
            status = data.get("task_status")
            if status == "success":
                results = data.get("results")
                if not results:
                    raise YouCamError(
                        f"task {task_id} succeeded with empty results",
                        code="bad_shape",
                        task_id=task_id,
                    )
                return results
            if status == "error":
                code = data.get("error") or data.get("error_code") or "error"
                raise YouCamError(f"task {task_id} failed: {code}", code=code, task_id=task_id)
            if self._clock() >= deadline:
                raise YouCamError(
                    f"task {task_id} still {status!r} after {timeout_s}s",
                    code="timeout",
                    task_id=task_id,
                )
            self._sleep(POLL_INTERVAL_S)

    def download(self, url: str, dest: Path) -> Path:
        resp = self._send_raw(Request("GET", url))
        if resp.status >= 300 or not resp.body:
            raise YouCamError(
                f"download failed with HTTP {resp.status}", code=f"http_{resp.status}"
            )
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(resp.body)
        return dest


def _sum_credits(node) -> int | None:
    """Credit payload shape is not documented in the brief; accept a few plausible ones."""
    if isinstance(node, bool):
        return None
    if isinstance(node, int):
        return node
    if isinstance(node, dict):
        for k in ("total_credits", "total_amount", "amount", "credit", "balance"):
            if k in node:
                return _sum_credits(node[k])
    if isinstance(node, list):
        parts = [_sum_credits(n) for n in node]
        parts = [p for p in parts if p is not None]
        return sum(parts) if parts else None
    return None

import "server-only";

/**
 * Minimal YouCam S2S client, ported from castforecast/youcam.py. The key lives only in this closure:
 * it is sent as a Bearer header to YOUCAM_BASE and never appears in a message, a field, a URL or a log.
 */

export const YOUCAM_BASE = "https://yce-api-01.makeupar.com";
export const JSON_TIMEOUT_MS = 15_000;
export const PUT_TIMEOUT_MS = 30_000;
export const POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_TIMEOUT_MS = 50_000;

export type TaskEndpoint = "task/makeup-vto" | "task/skin-tone-analysis" | "task/fitzpatrick-scale-analyzer";
const ENDPOINTS: ReadonlySet<string> = new Set<TaskEndpoint>([
  "task/makeup-vto",
  "task/skin-tone-analysis",
  "task/fitzpatrick-scale-analyzer",
]);

// A vendor code is a short identifier. Anything else (a sentence, control characters) is not trusted as a code.
const CODE_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
// Task ids go into a URL path. Base64 characters only, so no dot segment, query or fragment can form.
export const TASK_ID_RE = /^[A-Za-z0-9_+=/-]{1,256}$/;

export class YouCamError extends Error {
  code: string;
  status?: number;
  taskId?: string;
  constructor(message: string, code: string, o: { status?: number; taskId?: string } = {}) {
    super(message);
    this.name = "YouCamError";
    this.code = code;
    if (o.status !== undefined) this.status = o.status;
    if (o.taskId !== undefined) this.taskId = o.taskId;
  }
}

export type YouCam = {
  balance(): Promise<number>;
  upload(bytes: Uint8Array, fileName: string): Promise<string>;
  run(e: TaskEndpoint, payload: object): Promise<string>;
  poll(e: TaskEndpoint, taskId: string, timeoutMs?: number): Promise<Record<string, unknown>>;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const CREDIT_KEYS = ["total_credits", "total_amount", "amount", "credit", "balance"] as const;

/** Port of `_sum_credits` (youcam.py:245-259). The first key present decides; lists are summed; bool and string are refused. */
export function sumCredits(node: unknown): number | null {
  if (typeof node === "boolean") return null;
  if (typeof node === "number") return Number.isInteger(node) ? node : null;
  if (Array.isArray(node)) {
    const parts = node.map((n) => sumCredits(n)).filter((p): p is number => p !== null);
    return parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null;
  }
  if (isRecord(node)) {
    for (const k of CREDIT_KEYS) if (Object.hasOwn(node, k)) return sumCredits(node[k]);
  }
  return null;
}

function transportError(what: string, e: unknown): YouCamError {
  // Only the error's name is read. Its message can quote the request, so it never reaches ours.
  const name = typeof e === "object" && e !== null ? (e as { name?: unknown }).name : undefined;
  if (name === "TimeoutError" || name === "AbortError") return new YouCamError(`${what} timed out`, "timeout");
  return new YouCamError(`${what} could not connect`, "network");
}

function isHttpsUrl(s: string): boolean {
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
}

type Presigned = { fileId: string; url: string; method: string; headers: Record<string, string> };

/** Reads `data.files[0]` of a file registration. The PUT is later sent exactly as described here. */
function presigned(body: Record<string, unknown>): Presigned {
  const files = isRecord(body.data) ? body.data.files : undefined;
  const entry: unknown = Array.isArray(files) ? files[0] : undefined;
  const requests = isRecord(entry) ? entry.requests : undefined;
  const req: unknown = Array.isArray(requests) ? requests[0] : undefined;
  if (isRecord(entry) && isRecord(req)) {
    const { file_id: fileId } = entry;
    const { url, method, headers } = req;
    // Header values are strings, or a number such as Content-Length in the doc example; fetch sends either.
    const headersOk = isRecord(headers) && Object.values(headers).every((v) => typeof v === "string" || Number.isFinite(v));
    const methodOk = typeof method === "string" && ["PUT", "POST"].includes(method.toUpperCase());
    if (typeof fileId === "string" && fileId !== "" && typeof url === "string" && isHttpsUrl(url) && methodOk && headersOk) {
      return { fileId, url, method, headers: headers as Record<string, string> };
    }
  }
  throw new YouCamError("upload registration had an unexpected shape", "bad_shape");
}

function endpointPath(e: TaskEndpoint): string {
  if (!ENDPOINTS.has(e)) throw new YouCamError("unknown task endpoint", "bad_request");
  return `/s2s/v2.0/${e}`;
}

export function createYouCam(o: {
  key: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): YouCam {
  // Refused up front, as in youcam.py: a header error would quote the whole Bearer value.
  if (!o.key) throw new YouCamError("no key", "no_key");
  if (!/^[\x20-\x7e]+$/.test(o.key)) throw new YouCamError("key contains characters outside printable ASCII", "bad_key");
  const auth = `Bearer ${o.key}`;
  const doFetch: typeof fetch = o.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = o.now ?? (() => performance.now());

  async function send(
    what: string,
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string | Uint8Array<ArrayBuffer> },
    timeoutMs: number,
  ): Promise<Response> {
    try {
      // No redirects are followed: a 3xx comes back as a status, as in youcam.py.
      return await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    } catch (e) {
      throw transportError(what, e);
    }
  }

  async function readText(what: string, res: Response): Promise<string> {
    try {
      return await res.text();
    } catch (e) {
      throw transportError(what, e);
    }
  }

  /** Non-2xx: the body's `error_code` when it is code-shaped, else `http_<status>`. `status` is always set. */
  async function failure(what: string, res: Response): Promise<YouCamError> {
    let code = `http_${res.status}`;
    try {
      const body: unknown = JSON.parse(await res.text());
      if (isRecord(body) && typeof body.error_code === "string" && CODE_RE.test(body.error_code)) code = body.error_code;
    } catch {
      // An unreadable or non-JSON error body keeps http_<status>.
    }
    return new YouCamError(`${what} failed with HTTP ${res.status}`, code, { status: res.status });
  }

  async function api(method: "GET" | "POST", path: string, payload?: object): Promise<Record<string, unknown>> {
    const what = `${method} ${path}`;
    const headers: Record<string, string> = { Authorization: auth };
    let body: string | undefined;
    if (payload !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(payload);
    }
    const res = await send(what, YOUCAM_BASE + path, { method, headers, body }, JSON_TIMEOUT_MS);
    if (!res.ok) throw await failure(what, res);
    const text = await readText(what, res);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new YouCamError(`${what} returned non-JSON`, "bad_json", { status: res.status });
    }
    if (!isRecord(parsed)) throw new YouCamError(`${what} returned an unexpected shape`, "bad_shape", { status: res.status });
    return parsed;
  }

  return {
    async balance() {
      const body = await api("GET", "/s2s/v1.0/client/credit");
      // youcam.py:160 reads `results` whenever the key is present, else `data`.
      const total = sumCredits(Object.hasOwn(body, "results") ? body.results : body.data);
      if (total === null) throw new YouCamError("credit response had no recognisable balance", "bad_shape");
      return total;
    },

    async upload(bytes, fileName) {
      const body = await api("POST", "/s2s/v2.0/file", {
        files: [{ content_type: "image/jpeg", file_name: fileName, file_size: bytes.length }],
      });
      const p = presigned(body);
      // The presigned request carries exactly its own headers and never the Bearer key.
      const what = "upload PUT";
      const res = await send(what, p.url, { method: p.method, headers: p.headers, body: bytes as Uint8Array<ArrayBuffer> }, PUT_TIMEOUT_MS);
      if (!res.ok) throw await failure(what, res);
      await res.body?.cancel();
      return p.fileId;
    },

    async run(e, payload) {
      const body = await api("POST", endpointPath(e), payload);
      const taskId = isRecord(body.data) ? body.data.task_id : undefined;
      if (typeof taskId !== "string" || !TASK_ID_RE.test(taskId)) {
        throw new YouCamError("task start had no usable task_id", "bad_shape");
      }
      return taskId;
    },

    async poll(e, taskId, timeoutMs = DEFAULT_POLL_TIMEOUT_MS) {
      const base = endpointPath(e);
      if (!TASK_ID_RE.test(taskId)) throw new YouCamError("task id cannot be used in a path", "bad_task_id");
      const path = `${base}/${taskId}`;
      const deadline = now() + timeoutMs;
      // Order as youcam.py:207-231: GET, status checks, deadline check, then sleep.
      for (;;) {
        const body = await api("GET", path);
        const data = isRecord(body.data) ? body.data : {};
        if (data.task_status === "success") {
          const results = data.results;
          if (!isRecord(results) || Object.keys(results).length === 0) {
            throw new YouCamError("task succeeded with empty results", "bad_shape", { taskId });
          }
          return results;
        }
        if (data.task_status === "error") {
          // youcam.py reads `error`, then `error_code`; here the first one shaped like a code wins.
          const code = [data.error, data.error_code].find((c): c is string => typeof c === "string" && CODE_RE.test(c)) ?? "error";
          throw new YouCamError(`task failed: ${code}`, code, { taskId });
        }
        if (now() >= deadline) throw new YouCamError(`task did not finish within ${timeoutMs} ms`, "timeout", { taskId });
        await sleep(POLL_INTERVAL_MS);
      }
    },
  };
}

import { type CfErrorCode, MESSAGES } from "@/lib/messages";
import type { RenderResult } from "@/lib/types";

/**
 * Client deadlines, each above its route's maxDuration (upload 60 s, render 120 s), so the browser never gives up
 * on a request the server is still working on and could still charge for. They only end a connection that hung.
 */
export const UPLOAD_TIMEOUT_MS = 70_000;
export const RENDER_TIMEOUT_MS = 130_000;
/** Longest server line shown verbatim. */
const MAX_LINE = 200;

export class ApiFailure extends Error {
  readonly code: CfErrorCode;
  readonly retryAfterS?: number;
  /** `message` defaults to MESSAGES[code]; the client passes the server's line only for a 429. */
  constructor(code: CfErrorCode, retryAfterS?: number, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = "ApiFailure";
    this.code = code;
    this.retryAfterS = retryAfterS;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCode = (v: unknown): v is CfErrorCode => typeof v === "string" && Object.prototype.hasOwnProperty.call(MESSAGES, v);

function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : undefined;
}

function retryAfter(res: Response): number | undefined {
  const v = res.headers.get("retry-after");
  return v !== null && /^\d{1,6}$/.test(v) ? Number(v) : undefined;
}

/** A rejected fetch or body read: our own deadline is `timeout`, anything else (offline, reset) `upstream`. */
function transportFailure(e: unknown): ApiFailure {
  return new ApiFailure(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "upstream");
}

/** A non-2xx answer as an ApiFailure. Only an ApiErrorBody with a known code keeps its code; a 429 keeps its line. */
function errorFrom(res: Response, body: unknown): ApiFailure {
  const err = isRecord(body) ? body.error : undefined;
  if (!isRecord(err) || !isCode(err.code)) return new ApiFailure("upstream");
  const line = err.message;
  // A limiter refusal states the real wait (up to an hour), which the fixed MESSAGES line cannot.
  const keepLine = res.status === 429 && typeof line === "string" && line.length > 0 && line.length <= MAX_LINE;
  return new ApiFailure(err.code, retryAfter(res), keepLine ? line : undefined);
}

/** POSTs and returns the parsed 2xx JSON body. Every failure, including a 2xx that is not JSON, is an ApiFailure. */
async function post(url: string, init: RequestInit, f: typeof fetch): Promise<unknown> {
  let res: Response;
  let body: unknown;
  try {
    res = await f(url, { ...init, method: "POST", credentials: "same-origin" });
  } catch (e) {
    throw transportFailure(e);
  }
  try {
    body = await res.json();
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") throw transportFailure(e);
    body = undefined;
  }
  if (!res.ok) throw errorFrom(res, body);
  return body;
}

/** Sends the prepared selfie: the one path by which it leaves the browser. */
export async function uploadSelfie(blob: Blob, f: typeof fetch = fetch): Promise<{ fileId: string }> {
  const body = await post(
    "/api/upload",
    { headers: { "Content-Type": "image/jpeg" }, body: blob, signal: timeoutSignal(UPLOAD_TIMEOUT_MS) },
    f,
  );
  if (!isRecord(body) || typeof body.fileId !== "string" || body.fileId.length === 0) throw new ApiFailure("upstream");
  return { fileId: body.fileId };
}

function isRenderResult(v: unknown): v is RenderResult {
  return (
    isRecord(v) &&
    typeof v.imageUrl === "string" &&
    typeof v.bottleId === "string" &&
    Number.isFinite(v.colorIntensity) &&
    Number.isFinite(v.predictedBlend) &&
    Number.isFinite(v.expiresAt)
  );
}

/** Renders the bottle's cast on an uploaded selfie. */
export async function renderBottle(fileId: string, bottleId: string, tone: number, f: typeof fetch = fetch): Promise<RenderResult> {
  const body = await post(
    "/api/render",
    { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId, bottleId, tone }), signal: timeoutSignal(RENDER_TIMEOUT_MS) },
    f,
  );
  if (!isRenderResult(body)) throw new ApiFailure("upstream");
  return { imageUrl: body.imageUrl, bottleId: body.bottleId, colorIntensity: body.colorIntensity, predictedBlend: body.predictedBlend, expiresAt: body.expiresAt };
}

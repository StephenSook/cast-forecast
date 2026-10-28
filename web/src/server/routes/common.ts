import "server-only";
import type { z } from "zod";
import type { CfErrorCode } from "@/lib/messages";
import type { Hold } from "@/server/credits";
import type { RouteDeps } from "@/server/deps";
import { errorResponse, mapYouCamError } from "@/server/errors";
import { type TaskEndpoint, type YouCam, YouCamError } from "@/server/youcam";

/**
 * How long a paid route polls its task. The render and tone routes set maxDuration 120: their worst case is the body
 * read (BODY_READ_DEADLINE_MS), a balance read, a task start and this poll (whose last GET can start 2 s past an
 * interval), 10 + 15 + 15 + 50 + 2 + 15 = 107 s. Upload's is 10 + 15 + 30 = 55 s under its 60.
 */
export const POLL_TIMEOUT_MS = 50_000;
/**
 * Longest a route waits for the request body. Without it a trickled body plus a full-length task could pass
 * maxDuration, and the platform would end the invocation with a unit still held.
 */
export const BODY_READ_DEADLINE_MS = 10_000;
/** Largest JSON body the render and tone routes read. */
const MAX_JSON_BYTES = 4096;
/** An error name or code is logged only when it is a plain identifier, so nothing that came with it can ride along. */
const IDENT = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** A 200 JSON answer that is never cached. */
export function ok(body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status: 200, headers: { ...NO_STORE, ...headers } });
}

/** The media type of the request body, lower case, without parameters. */
export function mediaType(req: Request): string {
  return (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * The body bytes; "too_large" as soon as it passes `max` (nothing more is read); null when it cannot be read or is
 * still arriving after BODY_READ_DEADLINE_MS. The deadline timer is always cleared.
 */
export async function readCapped(req: Request, max: number): Promise<Uint8Array | "too_large" | null> {
  const declared = Number(req.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > max) return "too_large";
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"expired">((resolve) => {
    timer = setTimeout(() => resolve("expired"), BODY_READ_DEADLINE_MS);
  });
  // Not awaited: cancelling a stalled stream must not hold the answer up.
  const stop = () => void reader.cancel().catch(() => undefined);
  try {
    for (;;) {
      const step = await Promise.race([reader.read(), expired]);
      if (step === "expired") {
        stop();
        return null;
      }
      if (step.done) break;
      size += step.value.length;
      if (size > max) {
        stop();
        return "too_large";
      }
      parts.push(step.value);
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The body as JSON matching `schema`, or null when it is too large, not UTF-8, not JSON, or the wrong shape. */
export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T | null> {
  const bytes = await readCapped(req, MAX_JSON_BYTES);
  if (bytes === null || bytes === "too_large") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  const r = schema.safeParse(parsed);
  return r.success ? r.data : null;
}

/** A wait in words. From 120 s it is whole minutes, rounded up so the stated wait is never shorter than the real one. */
export function waitText(seconds: number): string {
  if (seconds >= 120) return `${Math.ceil(seconds / 60)} minutes`;
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

/**
 * A limiter refusal: 429 with Retry-After. `busy` (the caller's overflow shard was full) answers code busy, otherwise
 * rate_limited. The line states the actual wait, which can be up to an hour, so it is built here instead of taken from
 * the fixed MESSAGES line (whose "30 seconds" fits only an upstream throttle).
 */
export function refusal(r: { retryAfterS: number; busy?: true }): Response {
  const code: CfErrorCode = r.busy ? "busy" : "rate_limited";
  const lead = r.busy ? "Busy right now." : "Too many tries.";
  return Response.json(
    { error: { code, message: `${lead} Try again in ${waitText(r.retryAfterS)}.` } },
    { status: 429, headers: { ...NO_STORE, "Retry-After": String(r.retryAfterS) } },
  );
}

/**
 * One log line for a failure nobody planned for: the route, the error's name and, for a YouCamError, its code. Never
 * the message, which can carry a file id, a task id or a poll path; never the request, a header or a cookie.
 */
function logUnexpected(route: string, e: unknown): void {
  const raw = e instanceof Error ? e.name : typeof e;
  const name = IDENT.test(raw) ? raw : "Error";
  const code = e instanceof YouCamError && IDENT.test(e.code) ? ` code=${e.code}` : "";
  console.error(`[api/${route}] unexpected failure: ${name}${code}`);
}

/** A YouCam client failure as the API's error response. Anything that is not a YouCamError is also logged by name. */
export function failure(route: string, e: unknown): Response {
  if (!(e instanceof YouCamError)) logUnexpected(route, e);
  const m = mapYouCamError(e);
  return errorResponse(m.code, m.status, m.retryAfterS);
}

/** The client for `key`, or null when the client refuses the key (a configuration error: answer not_configured). */
export function youcamFor(route: string, d: RouteDeps, key: string): YouCam | null {
  try {
    return d.youcam(key);
  } catch (e) {
    if (!(e instanceof YouCamError)) logUnexpected(route, e);
    return null;
  }
}

/**
 * True only for a confirmed refusal of a task start: YouCam answered and its HTTP status was 4xx. A timeout, a
 * transport error, a 5xx, an error with no status, a 2xx whose body was unusable or a non-YouCam throw can all
 * follow a start YouCam accepted, so none of them counts.
 */
function startRefused(e: unknown): boolean {
  if (!(e instanceof YouCamError) || e.status === undefined) return false;
  return Number.isInteger(e.status) && e.status >= 400 && e.status < 500;
}

/**
 * One paid task. Holds `units` before the task starts (so concurrent requests on this instance cannot all pass the
 * floor on one balance). The hold is refunded only when `yc.run` fails with a confirmed refusal (startRefused: a
 * 4xx answer), so YouCam never took the task. Every other outcome keeps the units: success, unusable results, a
 * vendor error, a poll failure or timeout, and any task-start failure that is not a 4xx, because YouCam may already
 * have accepted and charged the task. Keeping them can over-count spend in the cache, which errs toward refusing a
 * task rather than going under the floor; the 30 s balance refresh reconciles it with the real balance. The
 * decision sits in `finally`, so no path out of here leaves a hold behind.
 */
export async function paidTask(
  route: string,
  d: RouteDeps,
  yc: YouCam,
  now: number,
  units: number,
  endpoint: TaskEndpoint,
  payload: object,
): Promise<{ results: Record<string, unknown> } | { response: Response }> {
  let hold: Hold | null;
  try {
    hold = await d.balance.reserve(yc, now, units, d.env.creditFloor);
  } catch (e) {
    return { response: failure(route, e) };
  }
  if (!hold) return { response: errorResponse("credits_low", 503) };
  let refused = false;
  try {
    const taskId = await yc.run(endpoint, payload).catch((e: unknown) => {
      refused = startRefused(e);
      throw e;
    });
    const results = await yc.poll(endpoint, taskId, POLL_TIMEOUT_MS);
    return { results };
  } catch (e) {
    return { response: failure(route, e) };
  } finally {
    if (refused) hold.refund();
    else hold.keep();
  }
}

/**
 * Wraps a handler so an unexpected throw still answers an ApiErrorBody (502 upstream) instead of an HTML 500. It logs
 * the name and any YouCamError code only (see logUnexpected).
 */
export function guarded(route: string, h: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await h(req);
    } catch (e) {
      logUnexpected(route, e);
      return errorResponse("upstream", 502);
    }
  };
}

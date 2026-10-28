import "server-only";
import type { z } from "zod";
import type { CfErrorCode } from "@/lib/messages";
import type { Hold } from "@/server/credits";
import type { RouteDeps } from "@/server/deps";
import { errorResponse, mapYouCamError } from "@/server/errors";
import type { TaskEndpoint, YouCam } from "@/server/youcam";

/**
 * How long a paid route polls its task. The render and tone routes set maxDuration 120: their worst case is a balance
 * read, a task start and this poll (whose last GET can start 2 s past an interval), 15 + 15 + 50 + 2 + 15 = 97 s.
 */
export const POLL_TIMEOUT_MS = 50_000;
/** Largest JSON body the render and tone routes read. */
const MAX_JSON_BYTES = 4096;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** A 200 JSON answer that is never cached. */
export function ok(body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status: 200, headers: { ...NO_STORE, ...headers } });
}

/** The media type of the request body, lower case, without parameters. */
export function mediaType(req: Request): string {
  return (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
}

/** The body bytes; "too_large" as soon as it passes `max` (nothing more is read); null when it cannot be read. */
export async function readCapped(req: Request, max: number): Promise<Uint8Array | "too_large" | null> {
  const declared = Number(req.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > max) return "too_large";
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel().catch(() => undefined);
        return "too_large";
      }
      parts.push(value);
    }
  } catch {
    return null;
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

/** A YouCam client failure as the API's error response. */
export function failure(e: unknown): Response {
  const m = mapYouCamError(e);
  return errorResponse(m.code, m.status, m.retryAfterS);
}

/** The client for `key`, or null when the client refuses the key (a configuration error: answer not_configured). */
export function youcamFor(d: RouteDeps, key: string): YouCam | null {
  try {
    return d.youcam(key);
  } catch {
    return null;
  }
}

/**
 * One paid task. Holds `units` before the task starts (so concurrent requests cannot all pass the floor on one
 * balance), then keeps them when the task succeeds or refunds them when the start or the poll fails or times out.
 * The refund sits in `finally`, so no path out of here leaves a hold behind.
 */
export async function paidTask(
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
    return { response: failure(e) };
  }
  if (!hold) return { response: errorResponse("credits_low", 503) };
  try {
    const taskId = await yc.run(endpoint, payload);
    const results = await yc.poll(endpoint, taskId, POLL_TIMEOUT_MS);
    // YouCam charges a task that succeeded, so its units stay spent even if the results turn out unusable.
    hold.keep();
    return { results };
  } catch (e) {
    return { response: failure(e) };
  } finally {
    hold.refund(); // a no-op once kept
  }
}

/** Wraps a handler so an unexpected throw still answers an ApiErrorBody (502 upstream) instead of an HTML 500. */
export function guarded(route: string, h: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await h(req);
    } catch (e) {
      // Name and message only: no request, header or cookie is logged.
      const what = e instanceof Error ? `${e.name}: ${e.message}` : typeof e;
      console.error(`[api/${route}] unexpected failure (${what})`);
      return errorResponse("upstream", 502);
    }
  };
}

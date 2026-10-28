import type { Bottle } from "@/lib/catalogue";
import { createBalanceCache } from "@/server/credits";
import type { RouteDeps } from "@/server/deps";
import type { ServerEnv } from "@/server/env";
import { createLimiter } from "@/server/limits";
import { BODY_READ_DEADLINE_MS, POLL_TIMEOUT_MS } from "@/server/routes/common";
import { newSession, sessionCookie } from "@/server/session";
import { JSON_TIMEOUT_MS, POLL_INTERVAL_MS, createYouCam } from "@/server/youcam";
import { CREDIT, NOW, SECRET, cookieHeaderFrom } from "./constants";
import { type Reply, fakeFetch, jsonReply } from "./fakeFetch";
import { testEnv } from "./env";

const ORIGIN = "https://cf.test";
const DEFAULT_IP = "203.0.113.1";

/**
 * Route deps over a scripted fetch and a fake clock. The limiter and balance cache are fresh per call of testDeps
 * and shared by every deps() call it returns. `balance` scripts the credit route; without it a balance read is
 * unscripted and fails the test.
 */
export function testDeps(o: {
  env?: Partial<ServerEnv>;
  catalogue?: readonly Bottle[];
  routes?: Record<string, Reply | Reply[]>;
  balance?: number;
} = {}): { deps: () => RouteDeps; ff: ReturnType<typeof fakeFetch>; clock: { now: number } } {
  const clock = { now: NOW };
  const routes: Record<string, Reply | Reply[]> = { ...o.routes };
  if (o.balance !== undefined) routes[CREDIT] = jsonReply(200, { results: { total_credits: o.balance } });
  const ff = fakeFetch(routes);
  const limiter = createLimiter();
  const balance = createBalanceCache();
  const env = testEnv(o.env);
  const catalogue = o.catalogue ?? [];
  const youcam = (key: string) =>
    createYouCam({ key, fetch: ff.fetch, sleep: async (ms) => { clock.now += ms; }, now: () => clock.now });
  return { deps: () => ({ env, youcam, limiter, catalogue, balance, now: () => clock.now }), ff, clock };
}

/** A Cookie header value for a fresh session holding `files`, signed with SECRET at NOW. */
export function cookieFor(files: string[]): string {
  return cookieHeaderFrom(sessionCookie({ ...newSession(NOW), files }, SECRET, true));
}

function headers(contentType: string | null, cookie?: string, ip?: string): Record<string, string> {
  const h: Record<string, string> = { "x-forwarded-for": ip ?? DEFAULT_IP };
  if (contentType) h["Content-Type"] = contentType;
  if (cookie) h.cookie = cookie;
  return h;
}

export function jpegPost(bytes: Uint8Array, cookie?: string, ip?: string): Request {
  return new Request(`${ORIGIN}/api/upload`, {
    method: "POST",
    body: bytes as Uint8Array<ArrayBuffer>,
    headers: headers("image/jpeg", cookie, ip),
  });
}

export function jsonPost(path: string, body: unknown, cookie?: string, ip?: string): Request {
  return new Request(`${ORIGIN}${path}`, { method: "POST", body: JSON.stringify(body), headers: headers("application/json", cookie, ip) });
}

export function get(path: string, ip?: string): Request {
  return new Request(`${ORIGIN}${path}`, { method: "GET", headers: headers(null, undefined, ip) });
}

/**
 * The worst case of a paid task route (carry 2): the body read up to its deadline, a balance read, a task start, then
 * a poll whose last GET starts just before its deadline after one more interval.
 */
export function taskRouteWorstCase(): { worstMs: number } {
  return {
    worstMs: BODY_READ_DEADLINE_MS + JSON_TIMEOUT_MS + JSON_TIMEOUT_MS + POLL_TIMEOUT_MS + POLL_INTERVAL_MS + JSON_TIMEOUT_MS,
  };
}

/** A request whose body sends `first` and then never ends, as a client trickling its upload would. */
export function stalledPost(path: string, contentType: string, first: Uint8Array, cookie?: string): Request {
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(first); } });
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    body,
    duplex: "half",
    headers: headers(contentType, cookie),
  } as RequestInit);
}

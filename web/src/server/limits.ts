import "server-only";

export type Action = "upload" | "render" | "tone" | "credits";

type Rule = { perSession: number; perIp: number; windowMs: number };

const HOUR_MS = 3_600_000;

/** Sliding one-hour windows per session and per IP. In memory, per instance (controller ruling 2). */
export const RULES: Record<Action, Rule> = {
  upload: { perSession: 6, perIp: 20, windowMs: HOUR_MS },
  render: { perSession: 20, perIp: 60, windowMs: HOUR_MS },
  tone: { perSession: 2, perIp: 6, windowMs: HOUR_MS },
  credits: { perSession: Infinity, perIp: 30, windowMs: HOUR_MS },
};

export type Limiter = {
  take(a: Action, sid: string | null, ip: string, now: number): { ok: true } | { ok: false; retryAfterS: number };
};

// Above this many buckets, a take first drops every bucket whose stamps have all expired.
const SWEEP_AT = 10_000;
const MAX_IP_LENGTH = 64;

export function createLimiter(rules: typeof RULES = RULES): Limiter {
  const stamps = new Map<string, number[]>();

  /** The stamps still inside the window, oldest first. Expired ones are dropped from the bucket. */
  function live(key: string, now: number, windowMs: number): number[] {
    const all = stamps.get(key) ?? [];
    const kept = all.filter((t) => now - t < windowMs);
    if (kept.length === 0) stamps.delete(key);
    else if (kept.length !== all.length) stamps.set(key, kept);
    return kept;
  }

  /** Seconds until one more take fits, or 0 when it already fits. */
  function wait(kept: number[], limit: number, now: number, windowMs: number): number {
    if (kept.length < limit) return 0;
    if (limit <= 0) return Math.ceil(windowMs / 1000);
    // The stamp that has to leave before the count drops under the limit (the oldest when count == limit).
    const binding = kept[kept.length - limit];
    return Math.max(1, Math.ceil((binding + windowMs - now) / 1000));
  }

  function record(key: string, now: number): void {
    const list = stamps.get(key) ?? [];
    let i = list.length;
    while (i > 0 && list[i - 1] > now) i--; // keep the list sorted if the clock stepped back
    list.splice(i, 0, now);
    stamps.set(key, list);
  }

  function sweep(now: number): void {
    const longest = Math.max(...Object.values(rules).map((r) => r.windowMs));
    for (const [key, list] of stamps) if (now - list[list.length - 1] >= longest) stamps.delete(key);
  }

  return {
    take(a, sid, ip, now) {
      if (stamps.size > SWEEP_AT) sweep(now);
      const { perSession, perIp, windowMs } = rules[a];
      // Namespaced so a session id can never land in an IP's bucket.
      const keys: [string, number][] = [[`${a}:ip:${ip}`, perIp]];
      if (sid !== null) keys.push([`${a}:sid:${sid}`, perSession]);
      let retryAfterS = 0;
      for (const [key, limit] of keys) retryAfterS = Math.max(retryAfterS, wait(live(key, now, windowMs), limit, now, windowMs));
      if (retryAfterS > 0) return { ok: false, retryAfterS }; // a denied take records nothing
      for (const [key] of keys) record(key, now);
      return { ok: true };
    },
  };
}

/** The first x-forwarded-for entry (the client, as Vercel sets it), trimmed and bounded, else "unknown". */
export function clientIp(req: Request): string {
  const first = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first ? first.slice(0, MAX_IP_LENGTH) : "unknown";
}

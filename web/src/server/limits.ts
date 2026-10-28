import "server-only";

export type Action = "upload" | "render" | "tone" | "credits";

type Rule = Readonly<{ perSession: number; perIp: number; windowMs: number }>;

const HOUR_MS = 3_600_000;

/** Sliding one-hour windows per session and per IP. In memory, per instance (controller ruling 2). Frozen. */
export const RULES: Readonly<Record<Action, Rule>> = Object.freeze({
  upload: Object.freeze({ perSession: 6, perIp: 20, windowMs: HOUR_MS }),
  render: Object.freeze({ perSession: 20, perIp: 60, windowMs: HOUR_MS }),
  tone: Object.freeze({ perSession: 2, perIp: 6, windowMs: HOUR_MS }),
  credits: Object.freeze({ perSession: Infinity, perIp: 30, windowMs: HOUR_MS }),
});

export type Limiter = {
  take(a: Action, sid: string | null, ip: string, now: number): { ok: true } | { ok: false; retryAfterS: number };
};

/** Most buckets one limiter holds. A new bucket past this evicts the least recently recorded one. */
const MAX_BUCKETS = 10_000;
const MAX_IP_LENGTH = 64;

export function createLimiter(rules: typeof RULES = RULES, maxBuckets: number = MAX_BUCKETS): Limiter {
  // One take can record two buckets, so fewer than two would let a take evict its own first bucket.
  if (!Number.isInteger(maxBuckets) || maxBuckets < 2) throw new RangeError("maxBuckets must be an integer >= 2");
  // Map order is the eviction order: a bucket moves to the back each time a take is recorded in it.
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
    const list = stamps.get(key);
    if (list) {
      let i = list.length;
      while (i > 0 && list[i - 1] > now) i--; // keep the list sorted if the clock stepped back
      list.splice(i, 0, now);
      stamps.delete(key);
      stamps.set(key, list);
      return;
    }
    while (stamps.size >= maxBuckets) {
      const oldest = stamps.keys().next().value;
      if (oldest === undefined) break;
      stamps.delete(oldest);
    }
    stamps.set(key, [now]);
  }

  return {
    take(a, sid, ip, now) {
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

function ipv4Octets(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

/** The eight 16-bit groups of an IPv6 address (`::` and a dotted IPv4 tail expanded), or null. */
function ipv6Groups(s: string): number[] | null {
  if (!s.includes(":")) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    const groups = part.split(":");
    for (const [k, g] of groups.entries()) {
      if (k === groups.length - 1 && g.includes(".")) {
        const v4 = ipv4Octets(g);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else if (/^[0-9a-fA-F]{1,4}$/.test(g)) {
        out.push(parseInt(g, 16));
      } else {
        return null;
      }
    }
    return out;
  };
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  return fill >= 1 ? [...head, ...new Array<number>(fill).fill(0), ...tail] : null;
}

/**
 * The limiter key for one address: IPv4 as given, IPv6 by its /64 prefix (one subscriber usually holds a
 * whole /64), an IPv4-mapped IPv6 address as its IPv4. Anything unparseable is kept, bounded in length.
 */
function ipKey(raw: string): string {
  let s = raw;
  if (s.startsWith("[")) s = s.slice(1, s.includes("]") ? s.indexOf("]") : undefined);
  if (s.includes("%")) s = s.slice(0, s.indexOf("%")); // IPv6 zone id
  if (ipv4Octets(s)) return s;
  const g = ipv6Groups(s);
  if (!g) return raw.slice(0, MAX_IP_LENGTH);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

/** Forwarding headers in the order Vercel's edge sets them; each holds the client address first. */
const VERCEL_IP_HEADERS = ["x-real-ip", "x-vercel-forwarded-for", "x-forwarded-for"] as const;

/**
 * The client key for rate limits. Only on Vercel (`VERCEL` set), where the edge writes these headers, are they
 * trusted: x-real-ip, then x-vercel-forwarded-for, then the first x-forwarded-for entry, else "unknown".
 * Anywhere else a client could forge them, so every request shares the one "local" bucket.
 */
export function clientIp(req: Request, env: Partial<NodeJS.ProcessEnv> = process.env): string {
  if (!env.VERCEL) return "local";
  for (const name of VERCEL_IP_HEADERS) {
    const first = req.headers.get(name)?.split(",")[0]?.trim();
    if (first) return ipKey(first);
  }
  return "unknown";
}

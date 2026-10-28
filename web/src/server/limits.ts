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

/**
 * `full: true` marks a refusal because this action's table is full of live buckets (the caller is not over
 * its own limit); `retryAfterS` is then the time until the earliest bucket can expire.
 */
export type Limiter = {
  take(a: Action, sid: string | null, ip: string, now: number): { ok: true } | { ok: false; retryAfterS: number; full?: true };
};

/** Most buckets one action's table holds. Only expired buckets are ever evicted to make room. */
const MAX_BUCKETS = 10_000;
const MAX_IP_LENGTH = 64;

/** One action's buckets, in recency order, and the earliest time any of them can expire (a lower bound). */
type Table = { buckets: Map<string, number[]>; nextExpiryAt: number };

export function createLimiter(rules: typeof RULES = RULES, maxBuckets: number = MAX_BUCKETS): Limiter {
  // One take can need two new buckets, so a table must hold at least two.
  if (!Number.isInteger(maxBuckets) || maxBuckets < 2) throw new RangeError("maxBuckets must be an integer >= 2");
  // A table per action, so a flood of one action can never crowd out another's buckets.
  const tables = new Map<Action, Table>();

  function table(a: Action): Table {
    let t = tables.get(a);
    if (!t) {
      t = { buckets: new Map(), nextExpiryAt: Number.NEGATIVE_INFINITY };
      tables.set(a, t);
    }
    return t;
  }

  /** The stamps still inside the window, oldest first. Expired ones are dropped from the bucket. */
  function live(t: Table, key: string, now: number, windowMs: number): number[] {
    const all = t.buckets.get(key) ?? [];
    const kept = all.filter((s) => now - s < windowMs);
    if (kept.length === 0) t.buckets.delete(key);
    else if (kept.length !== all.length) t.buckets.set(key, kept);
    return kept;
  }

  /** Moves an existing bucket to the back of its table's recency order. Allowed and denied takes both do this. */
  function touch(t: Table, key: string): void {
    const list = t.buckets.get(key);
    if (list) {
      t.buckets.delete(key);
      t.buckets.set(key, list);
    }
  }

  /**
   * Makes room for `needed` new buckets by evicting expired buckets only, never a live one. Returns 0 when
   * there is room, else the seconds until the earliest live bucket expires. The scan is skipped until that
   * time, so a flood against a full table costs O(1) per request.
   */
  function room(t: Table, needed: number, now: number, windowMs: number): number {
    if (t.buckets.size + needed <= maxBuckets) return 0;
    if (now >= t.nextExpiryAt) {
      let next = Number.POSITIVE_INFINITY;
      for (const [key, list] of t.buckets) {
        const expiresAt = list[list.length - 1] + windowMs;
        if (now >= expiresAt) t.buckets.delete(key);
        else next = Math.min(next, expiresAt);
      }
      t.nextExpiryAt = next;
      if (t.buckets.size + needed <= maxBuckets) return 0;
    }
    return Math.max(1, Math.ceil((t.nextExpiryAt - now) / 1000));
  }

  /** Seconds until one more take fits, or 0 when it already fits. */
  function wait(kept: number[], limit: number, now: number, windowMs: number): number {
    if (kept.length < limit) return 0;
    if (limit <= 0) return Math.ceil(windowMs / 1000);
    // The stamp that has to leave before the count drops under the limit (the oldest when count == limit).
    const binding = kept[kept.length - limit];
    return Math.max(1, Math.ceil((binding + windowMs - now) / 1000));
  }

  /** Adds a stamp; the bucket exists or `room` has made space for it. */
  function record(t: Table, key: string, now: number): void {
    const list = t.buckets.get(key);
    if (!list) {
      t.buckets.set(key, [now]);
      return;
    }
    let i = list.length;
    while (i > 0 && list[i - 1] > now) i--; // keep the list sorted if the clock stepped back
    list.splice(i, 0, now);
  }

  return {
    take(a, sid, ip, now) {
      const { perSession, perIp, windowMs } = rules[a];
      const t = table(a);
      // Namespaced so a session id can never land in an IP's bucket.
      const keys: [string, number][] = [[`ip:${ip}`, perIp]];
      if (sid !== null) keys.push([`sid:${sid}`, perSession]);
      let retryAfterS = 0;
      for (const [key, limit] of keys) retryAfterS = Math.max(retryAfterS, wait(live(t, key, now, windowMs), limit, now, windowMs));
      for (const [key] of keys) touch(t, key);
      if (retryAfterS > 0) return { ok: false, retryAfterS }; // a denied take records nothing
      const full = room(t, keys.filter(([key]) => !t.buckets.has(key)).length, now, windowMs);
      if (full > 0) return { ok: false, retryAfterS: full, full: true }; // fail closed, records nothing
      for (const [key] of keys) record(t, key, now);
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

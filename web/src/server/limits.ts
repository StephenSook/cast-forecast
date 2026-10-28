import "server-only";

export type Action = "upload" | "render" | "tone" | "credits";

type Rule = Readonly<{ perSession: number; perIp: number; windowMs: number }>;

const HOUR_MS = 3_600_000;

/**
 * Sliding one-hour windows per session and per IP. Frozen.
 * The limiter is in memory, per instance and best-effort (controller ruling 2): instances do not share counts
 * and a cold start forgets them. The global backstop is the live YouCam credit floor (credits.ts aboveFloor).
 * Under a distributed flood larger than the table cap within one window, newcomers in saturated overflow shards get
 * 429 busy with Retry-After; existing buckets are unaffected; the global credit floor guards the YouCam balance.
 */
export const RULES: Readonly<Record<Action, Rule>> = Object.freeze({
  upload: Object.freeze({ perSession: 6, perIp: 20, windowMs: HOUR_MS }),
  render: Object.freeze({ perSession: 20, perIp: 60, windowMs: HOUR_MS }),
  tone: Object.freeze({ perSession: 2, perIp: 6, windowMs: HOUR_MS }),
  credits: Object.freeze({ perSession: Infinity, perIp: 30, windowMs: HOUR_MS }),
});

/**
 * `busy: true` marks a refusal by the caller's overflow shard: the table was full of live buckets and that shard had
 * reached its limit (answer 429 busy with Retry-After). Without it, the caller's own limit refused it.
 */
export type Limiter = {
  take(a: Action, sid: string | null, ip: string, now: number): { ok: true } | { ok: false; retryAfterS: number; busy?: true };
};

/** Most buckets one action's table holds. */
const MAX_BUCKETS = 10_000;
/** Most session buckets one IP key may create per action per window; past that its IP bucket alone limits it. */
const MAX_SIDS_PER_IP = 20;
const MAX_IP_LENGTH = 64;

/** Overflow buckets per action. A new key that finds the table full lands in one, picked by its IP key. */
export const OVERFLOW_SHARDS = 64;

/** The overflow shard for an IP key (as `clientIp` returns it): FNV-1a 32-bit over its code units, mod 64. Stable. */
export function overflowShard(ip: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < ip.length; i++) {
    h ^= ip.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % OVERFLOW_SHARDS;
}

/** Stamps of allowed takes, oldest first; the bucket's own limit; for an IP bucket, when it created session buckets. */
type Bucket = { stamps: number[]; limit: number; mints: number[] };
/**
 * One action's buckets in recency order (every take moves its buckets to the back), its 64 overflow shards (stamps
 * per shard, never evicted), and `earliestExpiry`: no bucket can be fully expired before it. It stays a lower bound
 * because stamps are only added later and a bucket created after a scan expires after every bucket that scan saw.
 */
type Table = { buckets: Map<string, Bucket>; overflow: number[][]; earliestExpiry: number };

const inWindow = (list: number[], now: number, windowMs: number) => list.filter((s) => now - s < windowMs);

/** `onScan` is called each time a full table is scanned for expired buckets (a test seam; never needed in routes). */
export function createLimiter(
  rules: typeof RULES = RULES,
  maxBuckets: number = MAX_BUCKETS,
  onScan?: (a: Action) => void,
): Limiter {
  // One take can create two buckets, so a table must hold at least two.
  if (!Number.isInteger(maxBuckets) || maxBuckets < 2) throw new RangeError("maxBuckets must be an integer >= 2");
  // A table per action, so a flood of one action never fills another action's table.
  const tables = new Map<Action, Table>();

  function table(a: Action): Table {
    let t = tables.get(a);
    if (!t) {
      const overflow = Array.from({ length: OVERFLOW_SHARDS }, (): number[] => []);
      t = { buckets: new Map(), overflow, earliestExpiry: Number.NEGATIVE_INFINITY };
      tables.set(a, t);
    }
    return t;
  }

  /** The bucket at `key` with expired stamps and mints dropped, or undefined (an emptied bucket is deleted). */
  function bucket(t: Table, key: string, now: number, windowMs: number): Bucket | undefined {
    const b = t.buckets.get(key);
    if (!b) return undefined;
    b.stamps = inWindow(b.stamps, now, windowMs);
    b.mints = inWindow(b.mints, now, windowMs);
    if (b.stamps.length > 0) return b;
    t.buckets.delete(key);
    return undefined;
  }

  /** Moves a bucket to the back of the recency order. Allowed and denied takes both do this. */
  function touch(t: Table, key: string): void {
    const b = t.buckets.get(key);
    if (b) {
      t.buckets.delete(key);
      t.buckets.set(key, b);
    }
  }

  /**
   * True when the table has a free slot. At the cap it never evicts a bucket with a live stamp: before
   * `earliestExpiry` nothing can have expired, so it answers false in O(1); from then on one pass evicts the expired
   * buckets and recomputes `earliestExpiry`. A bucket created earlier in this same take has no stamp yet and is kept.
   */
  function makeRoom(a: Action, t: Table, now: number, windowMs: number): boolean {
    if (t.buckets.size < maxBuckets) return true;
    if (now < t.earliestExpiry) return false;
    onScan?.(a);
    let next = Number.POSITIVE_INFINITY;
    for (const [key, b] of t.buckets) {
      const newest = b.stamps.at(-1);
      if (newest === undefined) continue;
      if (now - newest >= windowMs) t.buckets.delete(key);
      else next = Math.min(next, newest + windowMs);
    }
    t.earliestExpiry = next;
    return t.buckets.size < maxBuckets;
  }

  /** Seconds until one more take fits, or 0 when it already fits. */
  function wait(kept: number[], limit: number, now: number, windowMs: number): number {
    if (kept.length < limit) return 0;
    if (limit <= 0) return Math.ceil(windowMs / 1000);
    // The stamp that has to leave before the count drops under the limit (the oldest when count == limit).
    const binding = kept[kept.length - limit];
    return Math.max(1, Math.ceil((binding + windowMs - now) / 1000));
  }

  function stamp(list: number[], now: number): void {
    let i = list.length;
    while (i > 0 && list[i - 1] > now) i--; // keep the list sorted if the clock stepped back
    list.splice(i, 0, now);
  }

  return {
    take(a, sid, ip, now) {
      const { perSession, perIp, windowMs } = rules[a];
      const t = table(a);
      // Namespaced so a session id can never land in an IP's bucket. An unlimited session rule needs no bucket.
      const ipKey = `ip:${ip}`;
      const sidKey = sid !== null && Number.isFinite(perSession) ? `sid:${sid}` : null;
      let ipB = bucket(t, ipKey, now, windowMs);
      let sidB = sidKey ? bucket(t, sidKey, now, windowMs) : undefined;

      let retryAfterS = 0;
      if (ipB) retryAfterS = wait(ipB.stamps, perIp, now, windowMs);
      if (sidB) retryAfterS = Math.max(retryAfterS, wait(sidB.stamps, perSession, now, windowMs));
      touch(t, ipKey);
      if (sidKey) touch(t, sidKey);
      if (retryAfterS > 0) return { ok: false, retryAfterS }; // a denied take records nothing

      let shard = -1;
      if (!ipB) {
        if (makeRoom(a, t, now, windowMs)) {
          ipB = { stamps: [], limit: perIp, mints: [] };
          t.buckets.set(ipKey, ipB);
        } else {
          // Full of live buckets: a new address shares its overflow shard (chosen by its IP key) under the IP limit,
          // so a flood saturates only the shards it hashes to. Shards are never evicted; existing buckets are unaffected.
          shard = overflowShard(ip);
          t.overflow[shard] = inWindow(t.overflow[shard], now, windowMs);
          const w = wait(t.overflow[shard], perIp, now, windowMs);
          if (w > 0) return { ok: false, retryAfterS: w, busy: true };
        }
      }
      // A new session bucket needs a real IP bucket under its mint cap and a free slot; otherwise the IP limit alone applies.
      if (sidKey && !sidB && ipB && ipB.mints.length < MAX_SIDS_PER_IP && makeRoom(a, t, now, windowMs)) {
        sidB = { stamps: [], limit: perSession, mints: [] };
        t.buckets.set(sidKey, sidB);
        stamp(ipB.mints, now);
      }

      if (shard >= 0) stamp(t.overflow[shard], now);
      if (ipB) stamp(ipB.stamps, now);
      if (sidB) stamp(sidB.stamps, now);
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

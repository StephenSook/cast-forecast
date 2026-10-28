import { expect, test, vi } from "vitest";
import { OVERFLOW_SHARDS, RULES, clientIp, createLimiter, overflowShard } from "@/server/limits";
import type { Action, Limiter } from "@/server/limits";
import { NOW } from "../helpers/constants";

const IP = "203.0.113.1";
// clientIp trusts forwarding headers only on Vercel (fix round 1); these tests pass the env explicitly.
const ON_VERCEL = { VERCEL: "1" };
const req = (headers: Record<string, string> = {}) => new Request("https://cf.test/", { headers });
test("upload allows 6 per session then returns retryAfter", () => {
  const l = createLimiter();
  for (let i = 0; i < 6; i++) expect(l.take("upload", "s1", IP, NOW)).toEqual({ ok: true });
  expect(l.take("upload", "s1", IP, NOW)).toEqual({ ok: false, retryAfterS: 3600 });
  expect(l.take("upload", "s1", IP, NOW + 600_000)).toEqual({ ok: false, retryAfterS: 3000 });
});
test("per-IP limit stops a fresh session after 20 uploads from one IP", () => {
  const l = createLimiter();
  for (const s of ["s1", "s2", "s3", "s4"]) for (let i = 0; i < 5; i++) expect(l.take("upload", s, IP, NOW).ok).toBe(true);
  expect(l.take("upload", "s5", IP, NOW).ok).toBe(false);
  expect(l.take("upload", "s5", "198.51.100.2", NOW).ok).toBe(true);
});
test("window slides after one hour and denials are not recorded", () => {
  const l = createLimiter();
  for (let i = 0; i < 6; i++) l.take("upload", "s1", IP, NOW);
  expect(l.take("upload", "s1", IP, NOW + 3_599_999).ok).toBe(false);
  expect(l.take("upload", "s1", IP, NOW + 3_600_000)).toEqual({ ok: true });
});
test("a null sid applies only the per-IP rule", () => {
  const l = createLimiter();
  for (let i = 0; i < 30; i++) expect(l.take("credits", null, IP, NOW).ok).toBe(true);
  expect(l.take("credits", null, IP, NOW).ok).toBe(false);
});
test("clientIp takes the first x-forwarded-for entry, else unknown", () => {
  expect(clientIp(req({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }), ON_VERCEL)).toBe("203.0.113.5");
  expect(clientIp(req(), ON_VERCEL)).toBe("unknown");
});

// Beyond the brief.
test("the rule table", () => expect(RULES).toEqual({
  upload: { perSession: 6, perIp: 20, windowMs: 3_600_000 },
  render: { perSession: 20, perIp: 60, windowMs: 3_600_000 },
  tone: { perSession: 2, perIp: 6, windowMs: 3_600_000 },
  credits: { perSession: Infinity, perIp: 30, windowMs: 3_600_000 },
}));
test("a session denial records nothing against the IP", () => {
  const l = createLimiter();
  for (let i = 0; i < 2; i++) expect(l.take("tone", "s1", IP, NOW).ok).toBe(true);
  for (let i = 0; i < 10; i++) expect(l.take("tone", "s1", IP, NOW).ok).toBe(false);
  for (const s of ["s2", "s2", "s3", "s3"]) expect(l.take("tone", s, IP, NOW).ok).toBe(true);   // IP total is now 6
  expect(l.take("tone", "s4", IP, NOW)).toEqual({ ok: false, retryAfterS: 3600 });
});
test("actions are counted apart", () => {
  const l = createLimiter();
  for (let i = 0; i < 2; i++) l.take("tone", "s1", IP, NOW);
  expect(l.take("tone", "s1", IP, NOW).ok).toBe(false);
  expect(l.take("render", "s1", IP, NOW).ok).toBe(true);
});
test("a sid spelled like an IP never shares that IP's bucket", () => {
  const l = createLimiter();
  for (const s of ["a", "a", "b", "b", "c", "c"]) expect(l.take("tone", s, IP, NOW).ok).toBe(true);  // IP bucket full (6)
  expect(l.take("tone", IP, "198.51.100.9", NOW)).toEqual({ ok: true });                         // sid bucket is empty
});
test("retryAfterS rounds up to whole seconds and takes the longer of two denials", () => {
  const l = createLimiter();
  for (const s of ["s2", "s3"]) for (let i = 0; i < 6; i++) l.take("upload", s, IP, NOW);          // IP 12, oldest at NOW
  for (let i = 0; i < 6; i++) l.take("upload", "s1", IP, NOW + 500_000);                          // s1 full, IP 18
  for (let i = 0; i < 2; i++) l.take("upload", "s4", IP, NOW + 500_000);                          // IP full (20)
  // session frees at NOW + 4_100_000 (3499.5 s away), IP at NOW + 3_600_000 (2999.5 s away)
  expect(l.take("upload", "s1", IP, NOW + 600_500)).toEqual({ ok: false, retryAfterS: 3500 });
  expect(l.take("upload", "s5", IP, NOW + 600_500)).toEqual({ ok: false, retryAfterS: 3000 });
});
test("clientIp trims and bounds the header", () => {
  expect(clientIp(req({ "x-forwarded-for": "  203.0.113.7 ,x" }), ON_VERCEL)).toBe("203.0.113.7");
  expect(clientIp(req({ "x-forwarded-for": " , 10.0.0.1" }), ON_VERCEL)).toBe("unknown");
  expect(clientIp(req({ "x-forwarded-for": "a".repeat(500) }), ON_VERCEL).length).toBeLessThanOrEqual(64);
});

// Fix round 1: IP source, IPv6 /64 keys, bounded buckets, frozen rules.
test("off Vercel every client shares the one local bucket, whatever the headers say", () => {
  const spoof = { "x-real-ip": "203.0.113.6", "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "203.0.113.8" };
  expect(clientIp(req(spoof), {})).toBe("local");
  expect(clientIp(req(), {})).toBe("local");
  expect(clientIp(req(spoof), { VERCEL: "" })).toBe("local");
});
test("on Vercel x-real-ip wins, then x-vercel-forwarded-for, then x-forwarded-for", () => {
  const all = { "x-real-ip": "203.0.113.1", "x-vercel-forwarded-for": "203.0.113.2", "x-forwarded-for": "203.0.113.3" };
  expect(clientIp(req(all), ON_VERCEL)).toBe("203.0.113.1");
  expect(clientIp(req({ "x-vercel-forwarded-for": " 203.0.113.2, 10.0.0.1", "x-forwarded-for": "203.0.113.3" }), ON_VERCEL)).toBe("203.0.113.2");
  expect(clientIp(req({ "x-real-ip": " ", "x-vercel-forwarded-for": "", "x-forwarded-for": "203.0.113.3" }), ON_VERCEL)).toBe("203.0.113.3");
});
test("clientIp reads process.env by default", () => {
  try {
    vi.stubEnv("VERCEL", "1");
    expect(clientIp(req({ "x-real-ip": "203.0.113.4" }))).toBe("203.0.113.4");
    vi.stubEnv("VERCEL", undefined);
    expect(clientIp(req({ "x-real-ip": "203.0.113.4" }))).toBe("local");
  } finally {
    vi.unstubAllEnvs();
  }
});
test("IPv6 clients are keyed by their /64 prefix; IPv4-mapped addresses read as IPv4", () => {
  const ip = (v: string) => clientIp(req({ "x-real-ip": v }), ON_VERCEL);
  expect(ip("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd:12::/64");
  expect(ip("2001:DB8:ABCD:0012::99")).toBe("2001:db8:abcd:12::/64");
  expect(ip("2001:db8:abcd:13::1")).toBe("2001:db8:abcd:13::/64");
  expect(ip("::1")).toBe("0:0:0:0::/64");
  expect(ip("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  expect(ip("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
  expect(ip("::ffff:203.0.113.9")).toBe("203.0.113.9");
  expect(ip("203.0.113.9")).toBe("203.0.113.9");
});
test("two addresses in one /64 share a limiter bucket", () => {
  const l = createLimiter();
  const ip = (v: string) => clientIp(req({ "x-real-ip": v }), ON_VERCEL);
  for (let i = 0; i < 6; i++) expect(l.take("tone", null, ip(`2001:db8:1:2::${i + 1}`), NOW).ok).toBe(true);
  expect(l.take("tone", null, ip("2001:db8:1:2:ffff:ffff:ffff:ffff"), NOW).ok).toBe(false);
  expect(l.take("tone", null, ip("2001:db8:1:3::1"), NOW).ok).toBe(true);
});
test("RULES is frozen, rule by rule", () => {
  expect(Object.isFrozen(RULES)).toBe(true);
  for (const r of Object.values(RULES)) expect(Object.isFrozen(r)).toBe(true);
  expect(() => { (RULES.upload as { perIp: number }).perIp = 1000; }).toThrow(TypeError);
  expect(RULES.upload.perIp).toBe(20);
});
// Bucket cap (final controller ruling): a bucket with any live stamp is never evicted. At the cap a new key goes to its
// action's shared overflow bucket, unless something can have expired (now >= earliestExpiry): then one scan evicts the
// expired buckets and the key gets its own bucket if room was made. One IP mints at most 20 session buckets per window.
const fill = (l: Limiter, a: Action, sid: string | null, ip: string, n: number, now: number) => {
  for (let i = 0; i < n; i++) expect(l.take(a, sid, ip, now).ok).toBe(true);
};
/** Takes until the first refusal (at most `max`) and returns how many were allowed. Changes the limiter. */
const remaining = (l: Limiter, a: Action, sid: string | null, ip: string, now: number, max = 100) => {
  let n = 0;
  while (n < max && l.take(a, sid, ip, now).ok) n++;
  return n;
};
const BUSY = (retryAfterS: number) => ({ ok: false, retryAfterS, busy: true });
/** The first `n` keys `${prefix}-<i>` whose overflow shard is `shard`. */
const keysInShard = (prefix: string, shard: number, n: number) => {
  const out: string[] = [];
  for (let i = 0; out.length < n; i++) {
    if (i > 100_000) throw new Error(`shard ${shard} unreachable`);
    if (overflowShard(`${prefix}-${i}`) === shard) out.push(`${prefix}-${i}`);
  }
  return out;
};
test("overflowShard is a stable hash of the IP key into 64 shards", () => {
  expect(OVERFLOW_SHARDS).toBe(64);
  expect(overflowShard("203.0.113.1")).toBe(18);                        // FNV-1a 32-bit mod 64, computed independently
  expect(overflowShard("2001:db8:abcd:12::/64")).toBe(22);
  const seen = new Set(Array.from({ length: 1000 }, (_, i) => overflowShard(`198.51.${i >> 8}.${i & 255}`)));
  expect(seen.size).toBe(64);                                           // 1,000 addresses reach every shard
  for (const s of seen) expect(Number.isInteger(s) && s >= 0 && s < 64).toBe(true);
});
test("live buckets are never evicted by any flood: a bucket at its limit stays at its limit", () => {
  const l = createLimiter(RULES, 3);
  fill(l, "tone", null, "full", 6, NOW);
  fill(l, "tone", "s1", "one", 1, NOW);                                 // ip:one and sid:s1 fill the cap
  for (let i = 0; i < 300; i++) l.take("tone", `f${i}`, `flood-${i}`, NOW + 1000);
  expect(l.take("tone", null, "full", NOW + 1000)).toEqual({ ok: false, retryAfterS: 3599 });
  expect(remaining(l, "tone", "s1", "one", NOW + 1000)).toBe(1);        // s1 kept: 1 of 2
  expect(remaining(l, "tone", null, "one", NOW + 1000)).toBe(4);        // ip:one kept: 2 of 6
});
test("a flood into one overflow shard answers busy while a newcomer in another shard is admitted", () => {
  const l = createLimiter(RULES, 2);
  fill(l, "tone", null, "a", 1, NOW);
  fill(l, "tone", null, "b", 1, NOW);                                                          // full of live buckets
  const shard = overflowShard("flood-0");
  const flood = keysInShard("flood", shard, 8);
  for (const ip of flood.slice(0, 6)) expect(l.take("tone", null, ip, NOW + 1000)).toEqual({ ok: true });
  for (const ip of flood.slice(6)) expect(l.take("tone", null, ip, NOW + 1000)).toEqual(BUSY(3600));
  expect(l.take("tone", null, flood[0], NOW + 1000)).toEqual(BUSY(3600));                      // still in its shard
  const newcomer = keysInShard("newcomer", (shard + 1) % OVERFLOW_SHARDS, 1)[0];
  expect(l.take("tone", null, newcomer, NOW + 1000)).toEqual({ ok: true });                    // another shard admits
  fill(l, "tone", null, "a", 1, NOW + 2000);                                                   // existing keys still served
  fill(l, "tone", null, "b", 1, NOW + 2000);
  expect(l.take("tone", null, keysInShard("late", shard, 1)[0], NOW + 3_601_000)).toEqual({ ok: true });   // shard slid
});
test("with earliestExpiry in the future, a full table sends new keys to overflow without scanning", () => {
  const scans: Action[] = [];
  const l = createLimiter(RULES, 2, (a) => scans.push(a));
  fill(l, "credits", null, "a", 1, NOW);
  fill(l, "credits", null, "b", 1, NOW);
  expect(scans).toEqual([]);                                                                   // below the cap
  l.take("credits", null, "n0", NOW + 1000);
  expect(scans).toEqual(["credits"]);                                                          // first full hit: one scan
  for (let i = 1; i < 50; i++) l.take("credits", null, `n${i}`, NOW + 2000);
  expect(scans).toHaveLength(1);                                                               // no scan until a can expire
  expect(l.take("credits", null, "late", NOW + 3_600_000)).toEqual({ ok: true });
  expect(scans).toHaveLength(2);
});
test("expired buckets are evicted and their room goes to a new key's own bucket", () => {
  const l = createLimiter(RULES, 2);
  fill(l, "tone", null, "a", 1, NOW);
  fill(l, "tone", null, "b", 1, NOW + 1_000_000);
  const t = NOW + 3_600_000;                                                                   // a has expired, b has not
  expect(l.take("tone", null, "c", t)).toEqual({ ok: true });
  expect(remaining(l, "tone", null, "c", t)).toBe(5);                                          // c's own bucket, now full
  expect(l.take("tone", null, "d", t)).toEqual({ ok: true });                                  // overflow is still empty
  expect(remaining(l, "tone", null, "b", t)).toBe(5);                                          // b kept
});
test("making room for a new session never drops the IP bucket created in the same take", () => {
  const l = createLimiter(RULES, 3);
  fill(l, "upload", null, "A", 1, NOW);
  fill(l, "upload", null, "B", 1, NOW + 2_000_000);
  const t = NOW + 3_600_000;                                                                   // A expired, never scanned
  expect(l.take("upload", "s9", "N", t)).toEqual({ ok: true });                                // N fills the cap; s9 takes A's room
  expect(remaining(l, "upload", "s9", "N", t)).toBe(5);                                        // s9: 6 of 6
  expect(remaining(l, "upload", null, "N", t)).toBe(14);                                       // N: 20 of 20
});
test("one IP mints at most 20 session buckets per window; past that its IP bucket alone limits it", () => {
  const l = createLimiter();
  for (let i = 1; i <= 20; i++) fill(l, "render", `s${i}`, "X", 1, NOW);
  expect(remaining(l, "render", "s21", "X", NOW, 21)).toBe(21);         // no s21 bucket, so perSession 20 never bites
  expect(remaining(l, "render", "s99", "Y", NOW, 21)).toBe(20);         // another IP still gets a session bucket
  expect(remaining(l, "render", "s22", "X", NOW + 3_600_000, 21)).toBe(20);   // the next window mints again
});
test("each action has its own table, so filling one never pushes another into overflow", () => {
  const l = createLimiter(RULES, 2);
  fill(l, "credits", null, "x", 1, NOW);
  fill(l, "credits", null, "y", 1, NOW);                                                       // credits table full
  fill(l, "tone", null, "t1", 6, NOW);
  fill(l, "tone", null, "t2", 6, NOW);                                                         // each has its own bucket
});
test("the default cap is 10,000 buckets per action; past it new keys share their shard's limit", () => {
  const l = createLimiter();
  fill(l, "credits", null, "first", 30, NOW);
  let refused = 0;
  for (let i = 1; i < 10_000; i++) if (!l.take("credits", null, `ip-${i}`, NOW).ok) refused++;
  expect(refused).toBe(0);                                                                     // 10,000 buckets
  let allowed = 0;
  for (const ip of keysInShard("late", overflowShard("late-0"), 40)) if (l.take("credits", null, ip, NOW).ok) allowed++;
  expect(allowed).toBe(30);                                                                    // one shard: the IP limit
  expect(l.take("credits", null, "first", NOW)).toEqual({ ok: false, retryAfterS: 3600 });     // never reset
  expect(remaining(l, "credits", null, "ip-1", NOW, 31)).toBe(29);                             // ip-1 kept its stamp
  expect(l.take("upload", "s1", "late-0", NOW)).toEqual({ ok: true });                         // another action's table
});
test("fewer than two buckets per table is refused", () => {
  expect(() => createLimiter(RULES, 1)).toThrow(RangeError);
  expect(() => createLimiter(RULES, 2.5)).toThrow(RangeError);
});

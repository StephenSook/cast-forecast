import { expect, test, vi } from "vitest";
import { RULES, clientIp, createLimiter } from "@/server/limits";
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
// Bucket cap (controller ruling): at the cap, expired buckets go first, then the bucket with the fewest live stamps
// (least recently used on ties), never one at or above half its limit; if every bucket is that busy, new keys share
// one overflow bucket per action. One IP mints at most 20 session buckets per window.
const fill = (l: Limiter, a: Action, sid: string | null, ip: string, n: number, now: number) => {
  for (let i = 0; i < n; i++) expect(l.take(a, sid, ip, now).ok).toBe(true);
};
/** Takes until the first refusal (at most `max`) and returns how many were allowed. Changes the limiter. */
const remaining = (l: Limiter, a: Action, sid: string | null, ip: string, now: number, max = 100) => {
  let n = 0;
  while (n < max && l.take(a, sid, ip, now).ok) n++;
  return n;
};
test("a flood of single-use keys at the cap evicts its own one-stamp buckets and still admits a new key", () => {
  const l = createLimiter(RULES, 10);
  fill(l, "credits", null, "legit", 3, NOW);                                                   // 3 of 30: below half
  for (let i = 0; i < 500; i++) expect(l.take("credits", null, `flood-${i}`, NOW).ok).toBe(true);
  expect(l.take("credits", null, "newcomer", NOW)).toEqual({ ok: true });
  expect(remaining(l, "credits", null, "legit", NOW)).toBe(27);                                // kept its 3 stamps
});
test("a bucket at or above half its limit is never evicted, even as the least recent with the fewest stamps", () => {
  const l = createLimiter(RULES, 3);
  fill(l, "tone", "s1", "A", 1, NOW);                                   // sid:s1 is 1 of 2: busy, and the oldest
  for (let i = 0; i < 300; i++) l.take("tone", null, `flood-${i}`, NOW);                       // one stamp each
  expect(remaining(l, "tone", "s1", "G", NOW)).toBe(1);                 // s1 kept its stamp
});
test("one IP mints at most 20 session buckets per window; past that its IP bucket alone limits it", () => {
  const l = createLimiter();
  for (let i = 1; i <= 20; i++) fill(l, "render", `s${i}`, "X", 1, NOW);
  expect(remaining(l, "render", "s21", "X", NOW, 21)).toBe(21);         // no s21 bucket, so perSession 20 never bites
  expect(remaining(l, "render", "s99", "Y", NOW, 21)).toBe(20);         // another IP still gets a session bucket
  expect(remaining(l, "render", "s22", "X", NOW + 3_600_000, 21)).toBe(20);   // the next window mints again
});
test("when every bucket is busy, new keys share one overflow bucket with the IP limit", () => {
  const l = createLimiter(RULES, 2);
  fill(l, "tone", null, "a", 3, NOW);
  fill(l, "tone", null, "b", 3, NOW);                                                          // both busy
  let allowed = 0;
  for (let i = 0; i < 20; i++) if (l.take("tone", null, `new-${i}`, NOW + 1000).ok) allowed++;
  expect(allowed).toBe(6);                                                                     // not none, not all
  expect(l.take("tone", null, "new-99", NOW + 1000)).toEqual({ ok: false, retryAfterS: 3600 });
  expect(remaining(l, "tone", null, "a", NOW + 1000)).toBe(3);                                 // busy buckets untouched
});
test("ties go to the least recently used bucket, and a denied take refreshes recency", () => {
  const l = createLimiter(RULES, 5);
  fill(l, "upload", "s1", "P1", 6, NOW);                                // ip:P1 6 of 20, sid:s1 6 of 6
  fill(l, "upload", null, "P2", 1, NOW);
  fill(l, "upload", null, "P3", 1, NOW);
  expect(l.take("upload", "s1", "P2", NOW).ok).toBe(false);            // refused by s1, but P2 is touched
  fill(l, "upload", null, "P4", 1, NOW);                                // five buckets: the cap
  expect(l.take("upload", null, "P5", NOW)).toEqual({ ok: true });     // evicts P3, not P2 or P4
  expect(remaining(l, "upload", null, "P2", NOW)).toBe(19);            // P2 kept its stamp
  expect(remaining(l, "upload", null, "P3", NOW)).toBe(20);            // P3 starts over: it was the one evicted
});
test("a new visitor at the cap gets both buckets, and its own room-making never drops either", () => {
  const l = createLimiter(RULES, 3);
  for (const ip of ["A", "B", "C"]) fill(l, "upload", null, ip, 1, NOW);                       // full of one-stamp buckets
  expect(l.take("upload", "s9", "N", NOW)).toEqual({ ok: true });                              // evicts A and B
  expect(remaining(l, "upload", "s9", "N", NOW)).toBe(5);                                      // s9: 1 of 6
  expect(remaining(l, "upload", null, "N", NOW)).toBe(14);                                     // N: 6 of 20
});
test("expired buckets go before any live one, even when the expired one was used more recently", () => {
  const l = createLimiter(RULES, 3);
  fill(l, "upload", "s1", "P", 6, NOW);                                 // ip:P and sid:s1, stamps at NOW
  fill(l, "upload", null, "Q", 1, NOW + 3_000_000);
  expect(l.take("upload", "s1", "P", NOW + 3_500_000).ok).toBe(false); // touches P and s1, so Q is least recent
  expect(l.take("upload", null, "Z", NOW + 3_600_000)).toEqual({ ok: true });   // P and s1 have expired
  expect(remaining(l, "upload", null, "Q", NOW + 3_600_000)).toBe(19);           // Q kept
});
test("each action has its own table, so flooding one never evicts another's bucket", () => {
  const l = createLimiter(RULES, 2);
  fill(l, "tone", null, "a", 1, NOW);                                                          // 1 of 6: evictable
  for (let i = 0; i < 50; i++) expect(l.take("credits", null, `flood-${i}`, NOW).ok).toBe(true);
  expect(remaining(l, "tone", null, "a", NOW)).toBe(5);
});
test("the default cap is 10,000 buckets per action", () => {
  const l = createLimiter();
  fill(l, "credits", null, "first", 30, NOW);                                                  // at its limit
  let refused = 0;
  for (let i = 1; i <= 10_050; i++) if (!l.take("credits", null, `ip-${i}`, NOW).ok) refused++;
  expect(refused).toBe(0);
  expect(l.take("credits", null, "first", NOW)).toEqual({ ok: false, retryAfterS: 3600 });     // never reset
  expect(remaining(l, "credits", null, "ip-1", NOW, 31)).toBe(30);                             // ip-1 was evicted
});
test("fewer than two buckets per table is refused", () => {
  expect(() => createLimiter(RULES, 1)).toThrow(RangeError);
  expect(() => createLimiter(RULES, 2.5)).toThrow(RangeError);
});

import { expect, test, vi } from "vitest";
import { RULES, clientIp, createLimiter } from "@/server/limits";
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
// The cap never evicts a live bucket: expired buckets go first, and a table still full of live ones refuses new keys.
test("a table full of live buckets refuses a new key and never resets a bucket at its limit", () => {
  const l = createLimiter(RULES, 3);
  for (let i = 0; i < 30; i++) expect(l.take("credits", null, "a", NOW).ok).toBe(true);
  expect(l.take("credits", null, "a", NOW)).toEqual({ ok: false, retryAfterS: 3600 });
  l.take("credits", null, "b", NOW);
  l.take("credits", null, "c", NOW + 1000);                                                    // full: a, b, c, all live
  expect(l.take("credits", null, "d", NOW + 1000)).toEqual({ ok: false, retryAfterS: 3599, full: true });
  for (let i = 0; i < 100; i++) expect(l.take("credits", null, `flood-${i}`, NOW + 2000).ok).toBe(false);
  expect(l.take("credits", null, "a", NOW + 2000)).toEqual({ ok: false, retryAfterS: 3598 });   // still at its limit
  expect(l.take("credits", null, "b", NOW + 2000)).toEqual({ ok: true });                       // known keys still served
});
test("expired buckets are evicted first and live ones stay", () => {
  const l = createLimiter(RULES, 3);
  for (let i = 0; i < 6; i++) l.take("tone", null, "a", NOW);
  l.take("tone", null, "b", NOW);
  for (let i = 0; i < 6; i++) l.take("tone", null, "c", NOW + 3_000_000);                       // c at its limit, newer
  expect(l.take("tone", null, "d", NOW + 3_599_999)).toEqual({ ok: false, retryAfterS: 1, full: true });
  expect(l.take("tone", null, "d", NOW + 3_600_000)).toEqual({ ok: true });                     // a and b expired
  expect(l.take("tone", null, "c", NOW + 3_600_000)).toEqual({ ok: false, retryAfterS: 3000 }); // c kept, still limited
  expect(l.take("tone", null, "e", NOW + 3_600_000)).toEqual({ ok: true });                     // the second freed slot
  expect(l.take("tone", null, "f", NOW + 3_600_000)).toEqual({ ok: false, retryAfterS: 3000, full: true });
});
test("each action has its own table, so flooding one never touches another", () => {
  const l = createLimiter(RULES, 2);
  for (let i = 0; i < 6; i++) l.take("tone", null, "a", NOW);                                  // tone: a at its limit
  for (let i = 0; i < 50; i++) l.take("credits", null, `flood-${i}`, NOW);
  expect(l.take("credits", null, "flood-99", NOW)).toMatchObject({ ok: false, full: true });
  expect(l.take("tone", null, "a", NOW)).toEqual({ ok: false, retryAfterS: 3600 });
  expect(l.take("tone", null, "b", NOW)).toEqual({ ok: true });
});
test("a take that needs two new buckets is refused when one slot is free, and records nothing", () => {
  const l = createLimiter(RULES, 3);
  expect(l.take("tone", "s1", IP, NOW)).toEqual({ ok: true });                                  // ip + s1
  expect(l.take("tone", "s2", "198.51.100.3", NOW)).toMatchObject({ ok: false, full: true });   // needs 2
  expect(l.take("tone", "s2", IP, NOW)).toEqual({ ok: true });                                  // needs 1
});
test("the default cap is 10,000 buckets per action and the 10,001st key is refused", () => {
  const l = createLimiter();
  for (let i = 0; i < 30; i++) l.take("credits", null, "first", NOW);
  let allowed = 0;
  for (let i = 1; i < 10_000; i++) if (l.take("credits", null, `ip-${i}`, NOW).ok) allowed++;
  expect(allowed).toBe(9_999);                                                                  // 10,000 buckets now
  expect(l.take("credits", null, "ip-10000", NOW)).toEqual({ ok: false, retryAfterS: 3600, full: true });
  expect(l.take("credits", null, "first", NOW)).toEqual({ ok: false, retryAfterS: 3600 });     // never reset
  expect(l.take("upload", "s1", "ip-10000", NOW)).toEqual({ ok: true });                       // another action's table
});
test("fewer than two buckets per table is refused", () => {
  expect(() => createLimiter(RULES, 1)).toThrow(RangeError);
  expect(() => createLimiter(RULES, 2.5)).toThrow(RangeError);
});

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
test("buckets are capped and the least recently used bucket goes first", () => {
  const l = createLimiter(RULES, 2);
  for (let i = 0; i < 30; i++) l.take("credits", null, "a", NOW);
  expect(l.take("credits", null, "a", NOW).ok).toBe(false);
  l.take("credits", null, "b", NOW);                                                           // buckets: a, b
  l.take("credits", null, "c", NOW);                                                           // a evicted
  expect(l.take("credits", null, "a", NOW).ok).toBe(true);                                     // a starts over
});
test("a recorded take moves its bucket to the back of the eviction order", () => {
  const l = createLimiter(RULES, 2);
  for (let i = 0; i < 29; i++) l.take("credits", null, "a", NOW);
  l.take("credits", null, "b", NOW);                                                           // order: a, b
  l.take("credits", null, "a", NOW);                                                           // a at 30; order: b, a
  l.take("credits", null, "c", NOW);                                                           // b evicted, a kept
  expect(l.take("credits", null, "a", NOW).ok).toBe(false);
});
test("the default cap is 10,000 buckets", () => {
  const l = createLimiter();
  for (let i = 0; i < 30; i++) l.take("credits", null, "first", NOW);
  for (let i = 1; i < 10_000; i++) l.take("credits", null, `ip-${i}`, NOW);                    // 10,000 buckets
  expect(l.take("credits", null, "first", NOW).ok).toBe(false);                                // still held
  l.take("credits", null, "ip-10000", NOW);                                                    // 10,001st evicts "first"
  expect(l.take("credits", null, "first", NOW).ok).toBe(true);
});

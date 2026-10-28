import { expect, test } from "vitest";
import { RULES, clientIp, createLimiter } from "@/server/limits";
import { NOW } from "../helpers/constants";

const IP = "203.0.113.1";
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
  expect(clientIp(new Request("https://cf.test/", { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } }))).toBe("203.0.113.5");
  expect(clientIp(new Request("https://cf.test/"))).toBe("unknown");
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
  expect(clientIp(new Request("https://cf.test/", { headers: { "x-forwarded-for": "  203.0.113.7 ,x" } }))).toBe("203.0.113.7");
  expect(clientIp(new Request("https://cf.test/", { headers: { "x-forwarded-for": " , 10.0.0.1" } }))).toBe("unknown");
  expect(clientIp(new Request("https://cf.test/", { headers: { "x-forwarded-for": "a".repeat(500) } })).length).toBeLessThanOrEqual(64);
});

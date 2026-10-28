import { createHmac } from "node:crypto";
import { expect, test } from "vitest";
import { MAX_FILES, SESSION_COOKIE, SESSION_TTL_S, newSession, readSession, sessionCookie, withFile } from "@/server/session";
import type { Session } from "@/server/session";
import { NOW, SECRET, cookieHeaderFrom } from "../helpers/constants";

const s0 = newSession(NOW);
const header = (s: Session, secret = SECRET) => cookieHeaderFrom(sessionCookie(s, secret, true));
test("newSession has v 1, a uuid sid, no files and iat NOW", () => {
  expect(s0).toMatchObject({ v: 1, files: [], iat: NOW }); expect(s0.sid).toMatch(/^[0-9a-f-]{36}$/);
});
test("round-trips a session among other cookies", () => {
  const s = withFile(s0, "f1");
  expect(readSession(`a=1; ${header(s)}; b=2`, SECRET, NOW + 1000)).toEqual(s);
});
test("rejects a tampered payload, a wrong secret and no header", () => {
  const sig = header(s0).split(".")[1];
  const forged = Buffer.from(JSON.stringify({ ...s0, files: ["someone-else"] })).toString("base64url");
  expect(readSession(`cf_session=${forged}.${sig}`, SECRET, NOW)).toBeNull();
  expect(readSession(header(s0, "x".repeat(48)), SECRET, NOW)).toBeNull();
  expect(readSession(null, SECRET, NOW)).toBeNull();
});
test("accepts a cookie at exactly 7200 s and rejects one older", () => {
  expect(readSession(header(s0), SECRET, NOW + 7_200_000)).not.toBeNull();
  expect(readSession(header(s0), SECRET, NOW + 7_200_001)).toBeNull();
});
test("withFile keeps the newest 4 fileIds", () => expect(["a","b","c","d","e"].reduce(withFile, s0).files).toEqual(["b","c","d","e"]));
test("cookie flags", () => {
  const c = sessionCookie(s0, SECRET, true);
  expect(c).toMatch(/^cf_session=[\w-]+\.[\w-]+;/); expect(c).toMatch(/HttpOnly/); expect(c).toMatch(/SameSite=Lax/);
  expect(c).toMatch(/Path=\//); expect(c).toMatch(/Max-Age=7200/); expect(c).toMatch(/Secure/);
  expect(sessionCookie(s0, SECRET, false)).not.toMatch(/Secure/);
});

// Beyond the brief. `signed` builds a correctly signed cookie for any payload, so these reach the shape checks.
const signed = (payload: unknown) => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `cf_session=${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
};
test("constants", () => expect([SESSION_COOKIE, SESSION_TTL_S, MAX_FILES]).toEqual(["cf_session", 7200, 4]));
test("the signing scheme is base64url(JSON).base64url(HMAC-SHA256)", () =>
  expect(readSession(signed(s0), SECRET, NOW)).toEqual(s0));
test.each([
  ["another version", { ...s0, v: 2 }],
  ["files that are not strings", { ...s0, files: [1] }],
  ["more than 4 files", { ...s0, files: ["a", "b", "c", "d", "e"] }],
  ["an empty file id", { ...s0, files: [""] }],
  ["a missing sid", { v: 1, files: [], iat: NOW }],
  ["a non-numeric iat", { ...s0, iat: "now" }],
  ["an extra field", { ...s0, admin: true }],
  ["an array", [s0]],
  ["an iat more than a minute ahead", { ...s0, iat: NOW + 60_001 }],
])("rejects a correctly signed payload with %s", (_name, payload) => expect(readSession(signed(payload), SECRET, NOW)).toBeNull());
test("rejects malformed cookie values", () => {
  for (const v of ["", "abc", "a.b.c", ".", `${header(s0).slice("cf_session=".length)}x`])
    expect(readSession(`cf_session=${v}`, SECRET, NOW), v).toBeNull();
});
test("a short secret neither signs nor verifies", () => {
  expect(() => sessionCookie(s0, "x".repeat(31), true)).toThrow();
  expect(readSession(header(s0), "x".repeat(31), NOW)).toBeNull();
});
test("withFile never changes the session it is given", () => {
  const before = JSON.stringify(s0);
  withFile(s0, "f1");
  expect(JSON.stringify(s0)).toBe(before);
});
test("the cookie never contains the secret", () => expect(sessionCookie(s0, SECRET, true)).not.toContain(SECRET));

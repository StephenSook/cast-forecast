import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/** A visitor's session, kept only in a signed cookie. Every `iat` and `now` is epoch milliseconds. */
export type Session = { v: 1; sid: string; files: string[]; iat: number };

export const SESSION_COOKIE = "cf_session";
export const SESSION_TTL_S = 7200;
export const MAX_FILES = 4;
const TTL_MS = SESSION_TTL_S * 1000;
// A cookie stamped further ahead than this is refused, so a cookie can never outlive its TTL.
const MAX_CLOCK_SKEW_MS = 60_000;
const MIN_SECRET_LENGTH = 32;
const MAX_FILE_ID_LENGTH = 512;

export function newSession(now: number): Session {
  return { v: 1, sid: randomUUID(), files: [], iat: now };
}

/** Returns a new session holding the newest MAX_FILES file ids. The input is never changed. */
export function withFile(s: Session, fileId: string): Session {
  return { ...s, files: [...s.files, fileId].slice(-MAX_FILES) };
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** A full Set-Cookie value: base64url(JSON) + "." + base64url(HMAC-SHA256), HttpOnly, SameSite=Lax, 2 hours. */
export function sessionCookie(s: Session, secret: string, secure: boolean): string {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error("session secret is too short");
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_TTL_S}`];
  if (secure) attrs.push("Secure");
  return [`${SESSION_COOKIE}=${body}.${sign(body, secret)}`, ...attrs].join("; ");
}

function cookieValue(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function isSession(v: unknown): v is Session {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    Object.keys(o).length === 4 &&
    o.v === 1 &&
    typeof o.sid === "string" &&
    /^[0-9a-f-]{36}$/.test(o.sid) &&
    Number.isSafeInteger(o.iat) &&
    Array.isArray(o.files) &&
    o.files.length <= MAX_FILES &&
    o.files.every((f) => typeof f === "string" && f.length > 0 && f.length <= MAX_FILE_ID_LENGTH)
  );
}

/**
 * The session in `cookieHeader` when its signature checks out (constant-time) and it is at most
 * SESSION_TTL_S old (`now - iat <= 7_200_000`). Null otherwise, never an exception.
 */
export function readSession(cookieHeader: string | null, secret: string, now: number): Session | null {
  if (!cookieHeader || secret.length < MIN_SECRET_LENGTH) return null;
  const value = cookieValue(cookieHeader, SESSION_COOKIE);
  const parts = value?.split(".");
  if (!parts || parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;
  const given = Buffer.from(sig);
  const expected = Buffer.from(sign(body, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isSession(parsed)) return null;
  const age = now - parsed.iat;
  if (age > TTL_MS || age < -MAX_CLOCK_SKEW_MS) return null;
  return parsed;
}

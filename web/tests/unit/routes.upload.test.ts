import { expect, test, vi } from "vitest";
import * as uploadRoute from "@/app/api/upload/route";
import * as jpeg from "@/server/jpeg";
import { MAX_UPLOAD_BYTES } from "@/server/jpeg";
import { BODY_READ_DEADLINE_MS, waitText } from "@/server/routes/common";
import { makeCreditsHandler } from "@/server/routes/credits";
import { makeRenderHandler } from "@/server/routes/render";
import { makeToneHandler } from "@/server/routes/tone";
import { makeUploadHandler } from "@/server/routes/upload";
import { readSession } from "@/server/session";
import { JSON_TIMEOUT_MS, PUT_TIMEOUT_MS } from "@/server/youcam";
import { NOW, PUT, REGISTER, SECRET, cookieHeaderFrom, registerReply } from "../helpers/constants";
import { jsonReply } from "../helpers/fakeFetch";
import { fakeJpeg } from "../helpers/fakeJpeg";
import { cookieFor, get, jpegPost, jsonPost, stalledPost, testDeps } from "../helpers/routes";

// The real functions, wrapped so a test can see whether the route reached them.
vi.mock("@/server/jpeg", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/jpeg")>();
  return { ...real, checkUploadImage: vi.fn(real.checkUploadImage), stripMetadata: vi.fn(real.stripMetadata) };
});

const firstCookie = (res: Response) => cookieHeaderFrom(res.headers.get("set-cookie")!);
const okUpload = { [REGISTER]: registerReply("file-1"), [PUT]: new Response(null, { status: 200 }) };

// toneEnabled: with TONE_ENABLED off, tone answers 404 before any of these checks (routes.tone.test.ts).
test("routes answer 503 not_configured without a key", async () => {                 // Review Focus 5
  const { deps, ff } = testDeps({ env: { youcamKey: null, toneEnabled: true } });
  const responses = [
    await makeUploadHandler(deps)(jpegPost(fakeJpeg(640, 480))),
    await makeRenderHandler(deps)(jsonPost("/api/render", { fileId: "file-1", bottleId: "test-a" }, cookieFor(["file-1"]))),
    await makeToneHandler(deps)(jsonPost("/api/tone", { fileId: "file-1" }, cookieFor(["file-1"]))),
    await makeCreditsHandler(deps)(get("/api/credits"))];
  for (const res of responses) { expect(res.status).toBe(503); expect((await res.json()).error.code).toBe("not_configured"); }
  expect(ff.calls).toEqual([]);
});
test("upload, render and tone answer 503 not_configured without a session secret", async () => {
  const { deps, ff } = testDeps({ env: { sessionSecret: null, toneEnabled: true } });
  const responses = [
    await makeUploadHandler(deps)(jpegPost(fakeJpeg(640, 480))),
    await makeRenderHandler(deps)(jsonPost("/api/render", { fileId: "file-1", bottleId: "test-a" })),
    await makeToneHandler(deps)(jsonPost("/api/tone", { fileId: "file-1" }))];
  for (const res of responses) { expect(res.status).toBe(503); expect((await res.json()).error.code).toBe("not_configured"); }
  expect(ff.calls).toEqual([]);
});
test("upload rejects a PNG body with 415 and calls nothing", async () => {
  const { deps, ff } = testDeps();
  const res = await makeUploadHandler(deps)(jpegPost(new Uint8Array([0x89, 0x50, 0x4e, 0x47])));
  expect(res.status).toBe(415); expect((await res.json()).error.code).toBe("unsupported_image"); expect(ff.calls).toEqual([]);
});
test("upload rejects a content type other than image/jpeg with 415", async () => {
  const { deps, ff } = testDeps();
  const req = new Request("https://cf.test/api/upload", { method: "POST", body: fakeJpeg(640, 480) as Uint8Array<ArrayBuffer>, headers: { "Content-Type": "image/png" } });
  expect((await makeUploadHandler(deps)(req)).status).toBe(415); expect(ff.calls).toEqual([]);
});
test("upload rejects 1920x1079 with 413 too_large", async () => {
  const { deps } = testDeps();
  const res = await makeUploadHandler(deps)(jpegPost(fakeJpeg(1920, 1079)));
  expect(res.status).toBe(413); expect((await res.json()).error.code).toBe("too_large");
});
test("upload registers, PUTs the bytes, returns fileId and sets a cookie listing it", async () => {
  const { deps, ff } = testDeps({ routes: okUpload });
  const res = await makeUploadHandler(deps)(jpegPost(fakeJpeg(640, 480)));
  expect(res.status).toBe(200); expect(await res.json()).toEqual({ fileId: "file-1" });
  expect(readSession(firstCookie(res), SECRET, NOW)!.files).toEqual(["file-1"]);
  expect(ff.calls.map((c) => c.method)).toEqual(["POST", "PUT"]);
});
test("upload strips APP1 and APP13 before the PUT and registers the stripped size", async () => {
  const { deps, ff } = testDeps({ routes: okUpload });
  const res = await makeUploadHandler(deps)(jpegPost(fakeJpeg(640, 480, "SOF0", { app1: true, app13: true })));
  expect(res.status).toBe(200);
  expect(ff.calls[1].body).toEqual(fakeJpeg(640, 480));
  expect(JSON.parse(ff.calls[0].body as string).files[0].file_size).toBe(fakeJpeg(640, 480).length);
});
test("upload reuses a valid cookie and keeps its sid", async () => {
  const { deps } = testDeps({ routes: { [REGISTER]: [registerReply("file-1"), registerReply("file-2")], [PUT]: new Response(null, { status: 200 }) } });
  const h = makeUploadHandler(deps);
  const a = await h(jpegPost(fakeJpeg(640, 480)));
  const b = await h(jpegPost(fakeJpeg(640, 480), firstCookie(a)));
  const sa = readSession(firstCookie(a), SECRET, NOW)!, sb = readSession(firstCookie(b), SECRET, NOW)!;
  expect(sb.sid).toBe(sa.sid); expect(sb.files).toEqual(["file-1", "file-2"]); expect(sb.iat).toBe(sa.iat);
});
test("a tampered cookie gets a new session, not an error", async () => {
  const { deps } = testDeps({ routes: okUpload });
  const res = await makeUploadHandler(deps)(jpegPost(fakeJpeg(640, 480), "cf_session=bad.sig"));
  expect(res.status).toBe(200); expect(readSession(firstCookie(res), SECRET, NOW)!.files).toEqual(["file-1"]);
});
test("upload returns 429 with Retry-After on the seventh upload in one session", async () => {
  const { deps, ff } = testDeps({ routes: okUpload });
  const h = makeUploadHandler(deps);
  let cookie: string | undefined;
  for (let i = 0; i < 6; i++) { const r = await h(jpegPost(fakeJpeg(640, 480), cookie)); expect(r.status).toBe(200); cookie = firstCookie(r); }
  const seventh = await h(jpegPost(fakeJpeg(640, 480), cookie));
  expect(seventh.status).toBe(429); expect(seventh.headers.get("retry-after")).toBe("3600");
  expect((await seventh.json()).error.code).toBe("rate_limited");
  expect(ff.calls.filter((c) => c.method === "POST")).toHaveLength(6);
});

// Beyond the brief.
const hasMarker = (b: Uint8Array, m: number) => b.some((x, i) => x === 0xff && b[i + 1] === m);
test("carry 3: the bytes sent to YouCam carry no APP1 or APP13 marker, while the input did", async () => {
  const { deps, ff } = testDeps({ routes: okUpload });
  const input = fakeJpeg(640, 480, "SOF0", { app1: true, app13: true });
  expect([hasMarker(input, 0xe1), hasMarker(input, 0xed)]).toEqual([true, true]);
  expect((await makeUploadHandler(deps)(jpegPost(input))).status).toBe(200);
  const sent = ff.calls[1].body as Uint8Array;
  expect([hasMarker(sent, 0xe1), hasMarker(sent, 0xed)]).toEqual([false, false]);
});
test("carry 3: a JPEG the strip cannot fully walk is 415 unsupported_image with no call", async () => {
  const { deps, ff } = testDeps({ routes: okUpload });
  const truncated = fakeJpeg(640, 480).slice(0, -2);                                          // no EOI: size reads, strip refuses
  const res = await makeUploadHandler(deps)(jpegPost(truncated));
  expect(res.status).toBe(415); expect((await res.json()).error.code).toBe("unsupported_image"); expect(ff.calls).toEqual([]);
  expect(res.headers.get("set-cookie")).toBeNull();
});
test("upload accepts image/jpeg with parameters and in any case", async () => {
  const { deps } = testDeps({ routes: okUpload });
  const req = new Request("https://cf.test/api/upload", { method: "POST", body: fakeJpeg(640, 480) as Uint8Array<ArrayBuffer>,
    headers: { "Content-Type": "Image/JPEG; charset=binary" } });
  expect((await makeUploadHandler(deps)(req)).status).toBe(200);
});
test("a body over the upload cap is 413 too_large with no call", async () => {
  const { deps, ff } = testDeps({ routes: okUpload });
  const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
  big.set(fakeJpeg(640, 480));
  const res = await makeUploadHandler(deps)(jpegPost(big));
  expect(res.status).toBe(413); expect((await res.json()).error.code).toBe("too_large"); expect(ff.calls).toEqual([]);
});
test("an upstream failure maps through mapYouCamError and sets no cookie", async () => {
  const { deps } = testDeps({ routes: { [REGISTER]: new Response("", { status: 429 }) } });
  const res = await makeUploadHandler(deps)(jpegPost(fakeJpeg(640, 480)));
  expect(res.status).toBe(503); expect(res.headers.get("retry-after")).toBe("30");
  expect((await res.json()).error.code).toBe("busy"); expect(res.headers.get("set-cookie")).toBeNull();
});
test("an upstream 401 (bad deploy key) is 503 not_configured, not 502", async () => {
  const { deps } = testDeps({ routes: { [REGISTER]: jsonReply(401, { error_code: "InvalidApiKey" }) } });
  const res = await makeUploadHandler(deps)(jpegPost(fakeJpeg(640, 480)));
  expect(res.status).toBe(503); expect((await res.json()).error.code).toBe("not_configured");
});
test("the cookie is Secure on https and not on http", async () => {
  const { deps } = testDeps({ routes: okUpload });
  const h = makeUploadHandler(deps);
  const secure = await h(jpegPost(fakeJpeg(640, 480)));
  const plain = await h(new Request("http://localhost/api/upload", { method: "POST", body: fakeJpeg(640, 480) as Uint8Array<ArrayBuffer>,
    headers: { "Content-Type": "image/jpeg" } }));
  expect(secure.headers.get("set-cookie")).toMatch(/; Secure$/);
  expect(plain.headers.get("set-cookie")).not.toMatch(/Secure/);
  expect(plain.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Lax/);
});
test("the rate_limited message states the real wait", async () => {
  const { deps } = testDeps({ routes: okUpload });
  const h = makeUploadHandler(deps);
  let cookie: string | undefined;
  for (let i = 0; i < 6; i++) cookie = firstCookie(await h(jpegPost(fakeJpeg(640, 480), cookie)));
  expect((await (await h(jpegPost(fakeJpeg(640, 480), cookie))).json()).error.message).toBe("Too many tries. Try again in 60 minutes.");
});

// Carry items 7 and 9: a limiter busy refusal is 429 busy, Retry-After = retryAfterS, and the line states that wait.
const busyDeps = (retryAfterS: number) => {
  const t = testDeps({ routes: okUpload });
  return { ...t, deps: () => ({ ...t.deps(), limiter: { take: () => ({ ok: false as const, retryAfterS, busy: true as const }) } }) };
};
test.each([[30, "Busy right now. Try again in 30 seconds."], [3600, "Busy right now. Try again in 60 minutes."]])(
  "a limiter busy refusal of %i s is 429 busy with that Retry-After and wait", async (s, line) => {
    const { deps, ff } = busyDeps(s);
    for (const res of [await makeUploadHandler(deps)(jpegPost(fakeJpeg(640, 480))), await makeCreditsHandler(deps)(get("/api/credits"))]) {
      expect(res.status).toBe(429); expect(res.headers.get("retry-after")).toBe(String(s));
      expect((await res.json()).error).toEqual({ code: "busy", message: line });
    }
    expect(ff.calls).toEqual([]);
  });
// Codex r2 finding E: the limiter runs before the body is read, so a refused caller costs no read, check or strip.
const untouched = (req: Request) => ({ used: req.bodyUsed, locked: req.body?.locked });
test("a caller over the session limit gets 429 before the body is read, checked or stripped", async () => {
  const { deps, ff } = testDeps({ routes: okUpload });
  const h = makeUploadHandler(deps);
  let cookie: string | undefined;
  for (let i = 0; i < 6; i++) cookie = firstCookie(await h(jpegPost(fakeJpeg(640, 480), cookie)));
  vi.mocked(jpeg.checkUploadImage).mockClear(); vi.mocked(jpeg.stripMetadata).mockClear();
  const seventh = jpegPost(fakeJpeg(640, 480), cookie);
  const res = await h(seventh);
  expect(res.status).toBe(429); expect((await res.json()).error.code).toBe("rate_limited");
  expect(untouched(seventh)).toEqual({ used: false, locked: false });
  expect(jpeg.checkUploadImage).not.toHaveBeenCalled(); expect(jpeg.stripMetadata).not.toHaveBeenCalled();
  expect(ff.calls.filter((c) => c.method === "POST")).toHaveLength(6);
});
test("a busy refusal never reads a 4 MB body", async () => {
  const { deps, ff } = busyDeps(30);
  vi.mocked(jpeg.checkUploadImage).mockClear(); vi.mocked(jpeg.stripMetadata).mockClear();
  const big = new Uint8Array(MAX_UPLOAD_BYTES);
  big.set(fakeJpeg(640, 480));
  const req = jpegPost(big);
  expect((await makeUploadHandler(deps)(req)).status).toBe(429);
  expect(untouched(req)).toEqual({ used: false, locked: false });
  expect(jpeg.checkUploadImage).not.toHaveBeenCalled(); expect(jpeg.stripMetadata).not.toHaveBeenCalled();
  expect(ff.calls).toEqual([]);
});
test("a marker-dense body (600 standalone markers after the frame header) is 415 with no call", async () => {
  const { deps, ff } = testDeps({ routes: okUpload });
  const plain = fakeJpeg(640, 480);
  const dense = new Uint8Array([...plain.slice(0, -2), ...Array.from({ length: 600 }, () => [0xff, 0xd0]).flat(), ...plain.slice(-2)]);
  const res = await makeUploadHandler(deps)(jpegPost(dense));
  expect(res.status).toBe(415); expect((await res.json()).error.code).toBe("unsupported_image");
  expect(ff.calls).toEqual([]);
});
test.each([[1, "1 second"], [30, "30 seconds"], [119, "119 seconds"], [120, "2 minutes"], [121, "3 minutes"], [3600, "60 minutes"]])(
  "waitText(%i) is %s (minutes round up, so the stated wait is never short)", (s, words) => expect(waitText(s)).toBe(words));

test("upload route config: nodejs, maxDuration 60 above the body read plus register plus PUT (55 s)", () => {
  expect(uploadRoute.runtime).toBe("nodejs");
  expect(uploadRoute.maxDuration).toBe(60);
  expect(uploadRoute.maxDuration * 1000).toBeGreaterThanOrEqual(BODY_READ_DEADLINE_MS + JSON_TIMEOUT_MS + PUT_TIMEOUT_MS + 5_000);
  expect(typeof uploadRoute.POST).toBe("function");
});
test("an upload body still arriving after 10 s is 400 bad_request with no call and no cookie", async () => {
  vi.useFakeTimers();
  try {
    const { deps, ff } = testDeps({ routes: okUpload });
    const pending = makeUploadHandler(deps)(stalledPost("/api/upload", "image/jpeg", fakeJpeg(640, 480).slice(0, 10)));
    await vi.advanceTimersByTimeAsync(BODY_READ_DEADLINE_MS);
    const res = await pending;
    expect(res.status).toBe(400); expect((await res.json()).error.code).toBe("bad_request");
    expect(res.headers.get("set-cookie")).toBeNull(); expect(ff.calls).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

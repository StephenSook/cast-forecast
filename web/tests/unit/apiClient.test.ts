import { expect, test, vi } from "vitest";
import { ApiFailure, RENDER_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, readSkinType, renderBottle, uploadSelfie } from "@/lib/apiClient";
import { type CfErrorCode, MESSAGES } from "@/lib/messages";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
test("uploadSelfie posts image/jpeg and returns fileId", async () => {
  const blob = new Blob(["x"], { type: "image/jpeg" }); const f = vi.fn(async () => json(200, { fileId: "file-1" }));
  expect(await uploadSelfie(blob, f)).toEqual({ fileId: "file-1" });
  expect(f).toHaveBeenCalledWith("/api/upload", expect.objectContaining({ method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob, credentials: "same-origin" }));
});
test("renderBottle posts JSON fileId, bottleId and tone", async () => {
  const f = vi.fn(async () => json(200, { imageUrl: "u", bottleId: "test-a", colorIntensity: 49, predictedBlend: 0.17, expiresAt: 1 }));
  await renderBottle("file-1", "test-a", 55, f);
  expect(f).toHaveBeenCalledWith("/api/render", expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: "file-1", bottleId: "test-a", tone: 55 }) }));
});
test("non-JSON error bodies become ApiFailure upstream", async () => {
  const e = await uploadSelfie(new Blob(["x"]), vi.fn(async () => new Response("<html>", { status: 502 }))).catch((x) => x);
  expect(e).toBeInstanceOf(ApiFailure); expect(e.code).toBe("upstream");
});
test("server error bodies become ApiFailure with their code and Retry-After", async () =>
  await expect(renderBottle("file-1", "test-a", 55, vi.fn(async () => json(503, { error: { code: "busy", message: "x" } }, { "Retry-After": "30" }))))
    .rejects.toMatchObject({ code: "busy", retryAfterS: 30 }));
test("an unknown code or a rejected fetch becomes upstream", async () => {
  await expect(renderBottle("f", "b", 55, vi.fn(async () => json(500, { error: { code: "weird", message: "x" } })))).rejects.toMatchObject({ code: "upstream" });
  await expect(renderBottle("f", "b", 55, vi.fn(async () => { throw new TypeError("offline"); }))).rejects.toMatchObject({ code: "upstream" });
});

// The statuses and codes the shipped routes answer (web/src/server/routes/*.ts and errors.ts). Outside a 429 the
// line is the visitor's line for the code, which is also what those routes send.
const SERVER: Array<[number, CfErrorCode]> = [
  [400, "bad_request"], [401, "session_missing"], [404, "unknown_bottle"], [413, "too_large"], [415, "unsupported_image"],
  [422, "too_small"], [422, "no_face"], [422, "face_position"], [422, "face_angle"], [422, "face_too_small"],
  [503, "not_configured"], [503, "credits_low"], [503, "busy"], [502, "upstream"], [504, "timeout"],
];
test.each(SERVER)("a %i %s answer becomes ApiFailure(%s) with its line", async (status, code) => {
  const f = vi.fn(async () => json(status, { error: { code, message: MESSAGES[code] } }));
  const e = await renderBottle("file-1", "test-a", 55, f).catch((x) => x);
  expect(e).toBeInstanceOf(ApiFailure);
  expect(e).toMatchObject({ code, message: MESSAGES[code], retryAfterS: undefined });
});

test("a 429 keeps the server's line, which states the real wait", async () => {
  const line = "Too many tries. Try again in 45 minutes.";
  const f = vi.fn(async () => json(429, { error: { code: "rate_limited", message: line } }, { "Retry-After": "2700" }));
  await expect(renderBottle("file-1", "test-a", 55, f)).rejects.toMatchObject({ code: "rate_limited", retryAfterS: 2700, message: line });
  const busy = "Busy right now. Try again in 12 minutes.";
  const g = vi.fn(async () => json(429, { error: { code: "busy", message: busy } }, { "Retry-After": "700" }));
  await expect(uploadSelfie(new Blob(["x"]), g)).rejects.toMatchObject({ code: "busy", retryAfterS: 700, message: busy });
});

test("a 429 with no usable line falls back to the code's line", async () => {
  for (const message of [undefined, "", 42, "x".repeat(201)]) {
    const f = vi.fn(async () => json(429, { error: { code: "rate_limited", message } }, { "Retry-After": "60" }));
    await expect(renderBottle("f", "b", 55, f)).rejects.toMatchObject({ code: "rate_limited", message: MESSAGES.rate_limited });
  }
});

test("a Retry-After that is not a whole number of seconds is dropped", async () => {
  for (const v of ["soon", "-5", "1.5", ""]) {
    const f = vi.fn(async () => json(503, { error: { code: "busy", message: "x" } }, { "Retry-After": v }));
    await expect(renderBottle("f", "b", 55, f)).rejects.toMatchObject({ code: "busy", retryAfterS: undefined });
  }
});

test("a JSON error body of the wrong shape is upstream", async () => {
  for (const body of [{}, { error: "busy" }, { error: { message: "x" } }, null, ["busy"]]) {
    await expect(renderBottle("f", "b", 55, vi.fn(async () => json(503, body)))).rejects.toMatchObject({ code: "upstream" });
  }
});

test("a 200 that does not carry the promised fields is upstream", async () => {
  for (const body of [{}, { fileId: "" }, { fileId: 7 }, "file-1"]) {
    await expect(uploadSelfie(new Blob(["x"]), vi.fn(async () => json(200, body)))).rejects.toMatchObject({ code: "upstream" });
  }
  const good = { imageUrl: "https://out.example/r.png", bottleId: "test-a", colorIntensity: 49, predictedBlend: 0.17, expiresAt: 1 };
  for (const bad of [{ ...good, imageUrl: 3 }, { ...good, colorIntensity: "49" }, { ...good, expiresAt: null }, { ...good, bottleId: undefined }]) {
    await expect(renderBottle("f", "b", 55, vi.fn(async () => json(200, bad)))).rejects.toMatchObject({ code: "upstream" });
  }
  await expect(renderBottle("f", "b", 55, vi.fn(async () => new Response("<html>", { status: 200 })))).rejects.toMatchObject({ code: "upstream" });
  expect(await renderBottle("f", "b", 55, vi.fn(async () => json(200, good)))).toEqual(good);
});

test("each deadline outlasts its route's own maxDuration", () => {
  expect(UPLOAD_TIMEOUT_MS).toBeGreaterThan(60_000);   // web/src/app/api/upload/route.ts maxDuration
  expect(RENDER_TIMEOUT_MS).toBeGreaterThan(120_000);  // web/src/app/api/render/route.ts maxDuration
});

test("uploadSelfie passes a signal that fires at UPLOAD_TIMEOUT_MS", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  try {
    const f = vi.fn<typeof fetch>(async () => json(200, { fileId: "file-1" }));
    await uploadSelfie(new Blob(["x"]), f);
    expect(timeout.mock.calls).toEqual([[UPLOAD_TIMEOUT_MS]]);
    const signal = f.mock.calls[0][1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal); expect(signal).toBe(timeout.mock.results[0].value);
  } finally {
    timeout.mockRestore();
  }
});

test("renderBottle passes a signal that fires at RENDER_TIMEOUT_MS", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  try {
    const f = vi.fn<typeof fetch>(async () => json(200, { imageUrl: "u", bottleId: "test-a", colorIntensity: 49, predictedBlend: 0.17, expiresAt: 1 }));
    await renderBottle("file-1", "test-a", 55, f);
    expect(timeout.mock.calls).toEqual([[RENDER_TIMEOUT_MS]]);
    const signal = f.mock.calls[0][1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal); expect(signal).toBe(timeout.mock.results[0].value);
  } finally {
    timeout.mockRestore();
  }
});

test("our own deadline passing is timeout, not upstream", async () => {
  const f = vi.fn(async () => { throw new DOMException("The operation timed out.", "TimeoutError"); });
  await expect(renderBottle("f", "b", 55, f)).rejects.toMatchObject({ code: "timeout", message: MESSAGES.timeout });
});

test("ApiFailure is an Error with the visitor's line", () => {
  const e = new ApiFailure("face_position");
  expect(e).toBeInstanceOf(Error); expect(e.message).toBe(MESSAGES.face_position); expect(e.retryAfterS).toBeUndefined();
});

test("readSkinType posts JSON fileId and returns only a type from I to VI", async () => {
  const f = vi.fn(async () => json(200, { fitzpatrick: "III", extra: 1 }));
  expect(await readSkinType("file-1", f)).toEqual({ fitzpatrick: "III" });
  expect(f).toHaveBeenCalledWith("/api/skin-type", expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: "file-1" }) }));
  for (const body of [{ fitzpatrick: "VII" }, { fitzpatrick: 3 }, {}, null]) {
    await expect(readSkinType("file-1", vi.fn(async () => json(200, body)))).rejects.toMatchObject({ code: "upstream" });
  }
  await expect(readSkinType("file-1", vi.fn(async () => json(422, { error: { code: "lighting", message: "x" } })))).rejects.toMatchObject({ code: "lighting" });
});

import { expect, test } from "vitest";
import { EXPIRED_LINE, type TryEvent, bottleFromParam, canPick, canSuggest, initialTryState, tryReducer } from "@/lib/tryFlow";
import { NOW } from "../helpers/constants";
import { testEntry } from "../helpers/entries";

const image = { blob: new Blob(["x"], { type: "image/jpeg" }), width: 640, height: 480, url: "blob:a" };
const result = { imageUrl: "https://out.example/r.png", bottleId: "test-a", colorIntensity: 49, predictedBlend: 0.1697, expiresAt: NOW + 6_900_000 };
const ready = ([{ type: "PHOTO_READY", image }, { type: "TONE", tone: 55 }] as TryEvent[]).reduce(tryReducer, initialTryState());
const done = ([{ type: "PICK", bottleId: "test-a" }, { type: "UPLOADED", fileId: "file-1" }, { type: "RENDERED", result }] as TryEvent[]).reduce(tryReducer, ready);
test("initial state is empty, keeps a preselected bottle, and cannot pick", () => {
  expect(initialTryState("test-b")).toMatchObject({ phase: "empty", bottleId: "test-b", fileId: null });
  expect(canPick(initialTryState("test-b"))).toBe(false);
});
test("ignores PICK while uploading or rendering", () => {
  const up = tryReducer(ready, { type: "PICK", bottleId: "test-a" });
  expect(up.phase).toBe("uploading"); expect(canPick(up)).toBe(false);
  expect(tryReducer(up, { type: "PICK", bottleId: "test-b" })).toBe(up);
  const ren = tryReducer(up, { type: "UPLOADED", fileId: "file-1" });
  expect(ren.phase).toBe("rendering"); expect(tryReducer(ren, { type: "PICK", bottleId: "test-b" })).toBe(ren);
});
test("reuses fileId for a second bottle", () =>
  expect(tryReducer(done, { type: "PICK", bottleId: "test-b" })).toMatchObject({ phase: "rendering", fileId: "file-1", bottleId: "test-b" }));
test("a new photo clears the fileId", () =>
  expect(tryReducer(done, { type: "PHOTO_READY", image })).toMatchObject({ phase: "ready", fileId: null, result: null }));
test("session_missing clears the fileId so the next pick uploads again", () => {
  const failed = tryReducer({ ...done, phase: "rendering" }, { type: "FAILED", code: "session_missing" });
  expect(failed).toMatchObject({ phase: "error", code: "session_missing", fileId: null });
  expect(tryReducer(failed, { type: "PICK", bottleId: "test-a" }).phase).toBe("uploading");
});
test("IMAGE_EXPIRED returns to ready with expired true and no fileId", () =>
  expect(tryReducer(done, { type: "IMAGE_EXPIRED" })).toMatchObject({ phase: "ready", expired: true, fileId: null, result: null }));

test("the expired line", () => expect(EXPIRED_LINE).toBe("That render expired. Pick the bottle again."));

test("a pick is possible only with a photo, and only when nothing is in flight", () => {
  expect(canPick(ready)).toBe(true);
  expect(canPick(done)).toBe(true);
  const noPhotoError = tryReducer(initialTryState(), { type: "FAILED", code: "unsupported_image" });
  expect(noPhotoError).toMatchObject({ phase: "error", code: "unsupported_image", image: null });
  expect(canPick(noPhotoError)).toBe(false);
  expect(tryReducer(noPhotoError, { type: "PICK", bottleId: "test-a" })).toBe(noPhotoError);
});

test("a pick selects the bottle and clears the last failure", () => {
  const failed = tryReducer({ ...done, phase: "rendering" }, { type: "FAILED", code: "rate_limited", message: "Too many tries. Try again in 45 minutes." });
  expect(failed).toMatchObject({ phase: "error", code: "rate_limited", message: "Too many tries. Try again in 45 minutes.", fileId: "file-1" });
  const again = tryReducer(failed, { type: "PICK", bottleId: "test-b" });
  expect(again).toMatchObject({ phase: "rendering", bottleId: "test-b", code: null, message: null, expired: false });
});

test("a failure without a server line keeps no stale line", () => {
  const first = tryReducer({ ...done, phase: "rendering" }, { type: "FAILED", code: "busy", message: "Busy right now. Try again in 2 minutes." });
  const picked = tryReducer(first, { type: "PICK", bottleId: "test-a" });
  expect(tryReducer(picked, { type: "FAILED", code: "upstream" })).toMatchObject({ code: "upstream", message: null });
});

test("a new photo and an expired render clear the failure and the expired flag", () => {
  const failed = tryReducer({ ...done, phase: "rendering" }, { type: "FAILED", code: "no_face" });
  expect(tryReducer(failed, { type: "PHOTO_READY", image })).toMatchObject({ phase: "ready", code: null, message: null, expired: false, bottleId: "test-a" });
  const expired = tryReducer(done, { type: "IMAGE_EXPIRED" });
  expect(tryReducer(expired, { type: "PHOTO_READY", image }).expired).toBe(false);
  expect(tryReducer(expired, { type: "PICK", bottleId: "test-a" })).toMatchObject({ phase: "uploading", expired: false });
});

test("a failure after an expired render shows the failure, not the expired line", () => {
  const expired = tryReducer(done, { type: "IMAGE_EXPIRED" });
  expect(tryReducer(expired, { type: "FAILED", code: "unsupported_image" })).toMatchObject({ phase: "error", code: "unsupported_image", expired: false });
});

test("an answer for a step that is no longer running is ignored", () => {
  expect(tryReducer(ready, { type: "UPLOADED", fileId: "file-9" })).toBe(ready);
  expect(tryReducer(ready, { type: "RENDERED", result })).toBe(ready);
  const up = tryReducer(ready, { type: "PICK", bottleId: "test-a" });
  expect(tryReducer(up, { type: "RENDERED", result })).toBe(up);
  expect(tryReducer(done, { type: "IMAGE_EXPIRED" }).phase).toBe("ready");
  expect(tryReducer(ready, { type: "IMAGE_EXPIRED" })).toBe(ready);
});

test("?bottle= preselects only a bottle in the list", () => {
  const list = [testEntry(), testEntry({ id: "test-b", name: "Test entry B" })];
  expect(bottleFromParam("test-b", list)).toBe("test-b");
  expect(bottleFromParam("nope", list)).toBeNull();
  expect(bottleFromParam(undefined, list)).toBeNull();
  expect(bottleFromParam(["test-a", "test-b"], list)).toBeNull();
  expect(bottleFromParam("test-a", [])).toBeNull();
});

test("no bottle can be picked without a tone with a prediction", () => {
  const photo = tryReducer(initialTryState(), { type: "PHOTO_READY", image });
  expect(canPick(photo)).toBe(false);
  expect(tryReducer(photo, { type: "PICK", bottleId: "test-a" })).toBe(photo);
  const deeper = tryReducer(photo, { type: "TONE", tone: "deeper" });
  expect(deeper.tone).toBe("deeper"); expect(canPick(deeper)).toBe(false);
  expect(canPick(tryReducer(deeper, { type: "TONE", tone: 50 }))).toBe(true);
});

test("a new tone clears the shown render but keeps the uploaded file, and waits while a render is in flight", () => {
  const retoned = tryReducer(done, { type: "TONE", tone: 45 });
  expect(retoned).toMatchObject({ phase: "ready", tone: 45, result: null, fileId: "file-1" });
  const inFlight = tryReducer(ready, { type: "PICK", bottleId: "test-a" });
  expect(tryReducer(inFlight, { type: "TONE", tone: 45 })).toBe(inFlight);
  expect(tryReducer(initialTryState(), { type: "TONE", tone: 60 })).toMatchObject({ phase: "empty", tone: 60 });
  const photoError = tryReducer(initialTryState(), { type: "FAILED", code: "too_small" });
  expect(tryReducer(photoError, { type: "TONE", tone: 60 })).toMatchObject({ phase: "error", code: "too_small", tone: 60 });
});

test("reading the skin type uploads once, suggests the type's tone, and keeps the file for the pick", () => {
  const photo = tryReducer(initialTryState(), { type: "PHOTO_READY", image });
  expect(canSuggest(initialTryState())).toBe(false); expect(canSuggest(photo)).toBe(true);
  const reading = tryReducer(photo, { type: "READ_SKIN" });
  expect(reading.phase).toBe("reading"); expect(canPick(reading)).toBe(false); expect(canSuggest(reading)).toBe(false);
  expect(tryReducer(reading, { type: "READ_SKIN" })).toBe(reading);
  expect(tryReducer(reading, { type: "TONE", tone: 60 })).toBe(reading);
  expect(tryReducer(reading, { type: "PICK", bottleId: "test-a" })).toBe(reading);
  const uploaded = tryReducer(reading, { type: "UPLOADED", fileId: "file-1" });
  expect(uploaded).toMatchObject({ phase: "reading", fileId: "file-1" });
  const read = tryReducer(uploaded, { type: "SKIN_READ", fitzpatrick: "IV" });
  expect(read).toMatchObject({ phase: "ready", skinType: "IV", tone: 55, fileId: "file-1" });
  expect(tryReducer(read, { type: "PICK", bottleId: "test-a" }).phase).toBe("rendering");
  expect(tryReducer(read, { type: "TONE", tone: 60 })).toMatchObject({ tone: 60, skinType: "IV" });
});
test("type VI suggests Deeper, which has no prediction, so no bottle can be picked", () => {
  const read = ([{ type: "PHOTO_READY", image }, { type: "READ_SKIN" }, { type: "UPLOADED", fileId: "file-1" },
    { type: "SKIN_READ", fitzpatrick: "VI" }] as TryEvent[]).reduce(tryReducer, initialTryState());
  expect(read).toMatchObject({ tone: "deeper", skinType: "VI" }); expect(canPick(read)).toBe(false);
});
test("a suggestion drops a shown render, a new photo forgets the type, and a stale answer changes nothing", () => {
  const reading = tryReducer(done, { type: "READ_SKIN" });
  expect(reading).toMatchObject({ phase: "reading", result: null, fileId: "file-1" });
  const read = tryReducer(reading, { type: "SKIN_READ", fitzpatrick: "II" });
  expect(read).toMatchObject({ tone: 65, skinType: "II" });
  expect(tryReducer(read, { type: "PHOTO_READY", image })).toMatchObject({ skinType: null, fileId: null });
  expect(tryReducer(ready, { type: "SKIN_READ", fitzpatrick: "V" })).toBe(ready);
  const failed = tryReducer(reading, { type: "FAILED", code: "lighting" });
  expect(failed).toMatchObject({ phase: "error", code: "lighting", tone: 55 }); expect(canPick(failed)).toBe(true);
});
test("SELECT marks a bottle picked only while no render can start, and never while one is in flight", () => {
  const empty = initialTryState();
  expect(tryReducer(empty, { type: "SELECT", bottleId: "test-b" })).toMatchObject({ phase: "empty", bottleId: "test-b" });
  expect(tryReducer(ready, { type: "SELECT", bottleId: "test-b" })).toBe(ready); // a render can start: that is a PICK
  const up = tryReducer(ready, { type: "PICK", bottleId: "test-a" });
  expect(tryReducer(up, { type: "SELECT", bottleId: "test-b" })).toBe(up);
});
test("a preselected tone (a bottle page's Try it on me) is kept from the start", () => {
  const s = initialTryState("test-a", 45);
  expect(s).toMatchObject({ tone: 45, bottleId: "test-a" });
  expect(canPick(tryReducer(s, { type: "PHOTO_READY", image }))).toBe(true);
});

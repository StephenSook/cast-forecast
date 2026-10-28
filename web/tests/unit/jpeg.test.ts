import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { MAX_UPLOAD_BYTES, checkUploadImage, jpegSize, stripMetadata } from "@/server/jpeg";
import { fakeJpeg } from "../helpers/fakeJpeg";

const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(s);

test("jpegSize reads a real baseline file and a progressive SOF2", () => {
  expect(jpegSize(readFileSync("tests/fixtures/plain-640x480.jpg"))).toEqual({ width: 640, height: 480 });
  expect(jpegSize(fakeJpeg(1919, 1079, "SOF2"))).toEqual({ width: 1919, height: 1079 });
});
test("checkUploadImage enforces width < 1920 and height < 1080 (makeup_vto.yaml:1276) and a 480 short side", () => {
  expect(checkUploadImage(fakeJpeg(1919, 1079))).toEqual({ ok: true, width: 1919, height: 1079 });
  expect(checkUploadImage(fakeJpeg(1920, 1079))).toEqual({ ok: false, code: "too_large", status: 413 });
  expect(checkUploadImage(fakeJpeg(1919, 1080))).toEqual({ ok: false, code: "too_large", status: 413 });
  expect(checkUploadImage(fakeJpeg(1919, 479))).toEqual({ ok: false, code: "too_small", status: 422 });
});
test("checkUploadImage refuses a non-JPEG and an oversized body", () => {
  expect(checkUploadImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toMatchObject({ code: "unsupported_image", status: 415 });
  expect(checkUploadImage(new Uint8Array(4_000_001))).toMatchObject({ code: "too_large" });
});
test("jpegSize returns null for a truncated file", () => expect(jpegSize(fakeJpeg(800, 600).slice(0, 12))).toBeNull());
test("stripMetadata removes only APP1 and APP13", () => {
  const meta = fakeJpeg(640, 480, "SOF0", { app1: true, app13: true });
  expect(has(meta, "Exif") && has(meta, "Photoshop")).toBe(true);                                // precondition
  expect(checkUploadImage(meta)).toEqual({ ok: true, width: 640, height: 480 });
  expect(stripMetadata(meta)).toEqual(fakeJpeg(640, 480));                                      // only APP1 and APP13 removed
  expect(stripMetadata(fakeJpeg(640, 480))).toEqual(fakeJpeg(640, 480));
  expect(stripMetadata(meta.slice(0, 30))).toBeNull();
});
test("stripMetadata removes real Pillow EXIF with GPS", () => {
  const src = readFileSync("tests/fixtures/exif-rot6-4032x3024.jpg");
  expect(has(src, "Exif")).toBe(true);                                                          // precondition
  const rot = stripMetadata(src)!;                                                              // real Pillow EXIF with GPS
  expect(has(rot, "Exif")).toBe(false); expect(jpegSize(rot)).toEqual({ width: 4032, height: 3024 });
});

// Beyond the brief.
test("the upload cap is 4,000,000 bytes, inclusive", () => {
  expect(MAX_UPLOAD_BYTES).toBe(4_000_000);
  expect(checkUploadImage(new Uint8Array(4_000_000))).toMatchObject({ code: "unsupported_image" });
});
test("checkUploadImage refuses the fixtures that the browser must shrink or cannot decode", () => {
  expect(checkUploadImage(readFileSync("tests/fixtures/tall-1080x4000.jpg"))).toEqual({ ok: false, code: "too_large", status: 413 });
  expect(checkUploadImage(readFileSync("tests/fixtures/not-an-image.heic"))).toEqual({ ok: false, code: "unsupported_image", status: 415 });
  expect(stripMetadata(readFileSync("tests/fixtures/not-an-image.heic"))).toBeNull();
});
test("stripMetadata keeps every other byte in order, from SOS on verbatim", () => {
  const src = readFileSync("tests/fixtures/exif-rot6-4032x3024.jpg");
  const out = stripMetadata(src)!;
  const app1At = src.indexOf(Buffer.from([0xff, 0xe1]));
  const app1Len = (src[app1At + 2] << 8) | src[app1At + 3];
  expect(Buffer.from(out).equals(Buffer.concat([src.subarray(0, app1At), src.subarray(app1At + 2 + app1Len)]))).toBe(true);
  expect(out).not.toBe(src);                                                                    // a copy, never the input
});
test("jpegSize skips a DHT segment (FF C4) instead of reading it as a frame", () => {
  const plain = fakeJpeg(700, 500);
  const dht = [0xff, 0xc4, 0x00, 0x07, 0x00, 0x01, 0x02, 0x03, 0x04];
  const withDht = new Uint8Array([...plain.slice(0, 20), ...dht, ...plain.slice(20)]);
  expect(jpegSize(withDht)).toEqual({ width: 700, height: 500 });
});
test("jpegSize returns null when the scan starts before any frame header", () =>
  expect(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]))).toBeNull());

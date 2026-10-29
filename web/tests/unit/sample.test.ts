import { readFileSync, readdirSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { CATALOGUE, RENDER_MAX_ERROR_L, TONES } from "@/lib/catalogue";
import { colorIntensityForBlend } from "@/lib/curve";
import {
  SAMPLE,
  SAMPLE_LIVE_LINE,
  loadSample,
  loadSampleFace,
  recordedReadLine,
  recordedRenderLine,
  sampleRender,
  shortDate,
} from "@/lib/sample";
import { SUGGESTED_TONE } from "@/lib/skinType";
import { checkUploadImage, jpegSize, stripMetadata } from "@/server/jpeg";
import { LABELS } from "@/server/labels";
import { findCopyViolations } from "../helpers/copyGuard";
import { pngIntact } from "../helpers/png";

const face = new Uint8Array(readFileSync("public/sample/face.jpg"));
const key = (bottleId: string, tone: number) => `${bottleId}@${tone}`;

test("the sample face is a JPEG the upload route takes as is: in limits, its stated size, nothing left to strip", () => {
  expect(checkUploadImage(face)).toEqual({ ok: true, width: SAMPLE.face.width, height: SAMPLE.face.height });
  expect(jpegSize(face)).toEqual({ width: SAMPLE.face.width, height: SAMPLE.face.height });
  const stripped = stripMetadata(face);
  expect(stripped !== null && Buffer.from(stripped).equals(Buffer.from(face))).toBe(true);
  const latin = Buffer.from(face).toString("latin1");
  for (const marker of ["Exif\0\0", "http://ns.adobe.com/xap", "Photoshop 3.0"]) expect(latin.includes(marker), marker).toBe(false);
});

// The pairs the live route renders today: a tone whose render exists, is close enough, and the K1b curve can reach.
const RENDERABLE = CATALOGUE.flatMap((b) =>
  b.tones
    .filter((t) => t.render !== null && t.render.errorL <= RENDER_MAX_ERROR_L && colorIntensityForBlend(t.render.blend).reachable)
    .map((t) => ({ bottle: b, tone: t })),
);

test("every featured bottle has one recording at every tone the live route renders, and nothing else is recorded", () => {
  expect(RENDERABLE.length).toBe(CATALOGUE.length * TONES.length); // today every featured pair renders; fails, never passes empty
  expect(SAMPLE.renders.map((r) => key(r.bottleId, r.tone)).sort()).toEqual(RENDERABLE.map((p) => key(p.bottle.id, p.tone.lStar)).sort());
});

test("each recording used the colorIntensity the live route sends for that bottle and tone today", () => {
  for (const { bottle, tone } of RENDERABLE) {
    const r = SAMPLE.renders.find((x) => x.bottleId === bottle.id && x.tone === tone.lStar);
    const want = colorIntensityForBlend(tone.render?.blend as number);
    expect({ id: key(bottle.id, tone.lStar), ci: r?.colorIntensity, blend: r?.predictedBlend }).toEqual({
      id: key(bottle.id, tone.lStar),
      ci: want.colorIntensity,
      blend: want.predictedBlend,
    });
  }
});

test("every shipped render decodes in full at the face's size, is named for its manifest entry, and none is unlisted", () => {
  const files = readdirSync("public/sample/renders").sort();
  expect(files).toEqual(SAMPLE.renders.map((r) => r.src.replace("/sample/renders/", "")).sort());
  expect(SAMPLE.renders).toHaveLength(40); // fails, never passes empty
  for (const r of SAMPLE.renders) {
    expect(r.src).toBe(`/sample/renders/${r.bottleId}-${r.tone}.png`);
    const b = new Uint8Array(readFileSync(`public${r.src}`));
    const size = pngIntact(b);
    expect(size, r.src).not.toBeNull();
    // YouCam returns the uploaded face at its own size, give or take a pixel (696 x 1080 for the 697 x 1079 face), so
    // a before and after split lines up.
    expect(Math.abs((size?.width ?? 0) - SAMPLE.face.width), r.src).toBeLessThanOrEqual(2);
    expect(Math.abs((size?.height ?? 0) - SAMPLE.face.height), r.src).toBeLessThanOrEqual(2);
    expect(b.length, r.src).toBeGreaterThan(50_000);
  }
});

test("the recorded skin read suggests a tone with a prediction, and every chip has a recording at that tone", () => {
  const tone = SUGGESTED_TONE[SAMPLE.skinType.fitzpatrick];
  expect(typeof tone).toBe("number");
  expect(TONES.map((t) => t.lStar)).toContain(tone);
  for (const b of CATALOGUE) expect(sampleRender(SAMPLE, b.id, tone as number), b.id).not.toBeNull();
});

test("a recording is found only for its own bottle and tone, never for a label that is not a chip", () => {
  const first = SAMPLE.renders[0];
  expect(sampleRender(SAMPLE, first.bottleId, first.tone)).toEqual({
    imageUrl: first.src,
    bottleId: first.bottleId,
    colorIntensity: first.colorIntensity,
    predictedBlend: first.predictedBlend,
    expiresAt: Number.MAX_SAFE_INTEGER,
    recordedOn: first.recordedOn,
  });
  expect(sampleRender(SAMPLE, first.bottleId, 44)).toBeNull();
  const notAChip = LABELS.find((b) => !CATALOGUE.some((c) => c.id === b.id));
  expect(notAChip).toBeDefined();
  for (const t of TONES) expect(sampleRender(SAMPLE, notAChip?.id as string, t.lStar)).toBeNull();
});

test("the manifest refuses another version and two recordings of one bottle at one tone", () => {
  expect(() => loadSample({ ...SAMPLE, schemaVersion: 2 })).toThrow();
  expect(() => loadSample({ ...SAMPLE, renders: [SAMPLE.renders[0], SAMPLE.renders[0]] })).toThrow(/two recordings/);
  expect(() => loadSample({ ...SAMPLE, renders: [{ ...SAMPLE.renders[0], src: "https://elsewhere.example/r.png" }] })).toThrow();
  expect(() => loadSample({ ...SAMPLE, renders: [{ ...SAMPLE.renders[0], src: "/sample/renders/x-55.jpg" }] })).toThrow(); // PNG only
});

test("the recorded labels name the API and the date, in few words and within the copy rules", () => {
  expect(shortDate("2026-10-29")).toBe("Oct 29, 2026");
  expect(shortDate("2026-01-05")).toBe("Jan 5, 2026");
  expect(recordedRenderLine("2026-10-29")).toBe("Recorded render (YouCam Makeup VTO, Oct 29, 2026)");
  expect(recordedReadLine("IV", "2026-10-29")).toBe(
    "Recorded read (YouCam Fitzpatrick Skin Type, Oct 29, 2026): type IV. We picked the closest tone; change it if it looks off.",
  );
  expect(SAMPLE_LIVE_LINE).toBe("Live render needs your own selfie.");
  const lines = [recordedRenderLine("2026-10-29"), recordedReadLine("IV", "2026-10-29"), SAMPLE_LIVE_LINE].join("\n");
  expect(findCopyViolations(lines, "sample lines")).toEqual([]);
  expect(lines).not.toMatch(/[‘’“”]/);
});

test("the sample face loads as a prepared image marked sample, and a failed or wrong answer rejects", async () => {
  const jpeg = new Blob([face], { type: "image/jpeg" });
  const ok = vi.fn(async () => new Response(jpeg, { status: 200 }));
  const img = await loadSampleFace(SAMPLE, ok as unknown as typeof fetch, () => "blob:sample");
  expect(ok).toHaveBeenCalledWith("/sample/face.jpg");
  expect(img).toMatchObject({ width: SAMPLE.face.width, height: SAMPLE.face.height, url: "blob:sample", sample: true });
  const missing = vi.fn(async () => new Response("no", { status: 404 }));
  await expect(loadSampleFace(SAMPLE, missing as unknown as typeof fetch, () => "blob:x")).rejects.toThrow(/404/);
  const html = vi.fn(async () => new Response(new Blob(["<html>"], { type: "text/html" }), { status: 200 }));
  await expect(loadSampleFace(SAMPLE, html as unknown as typeof fetch, () => "blob:x")).rejects.toThrow(/not a JPEG/);
});

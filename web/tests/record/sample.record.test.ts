import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { CATALOGUE, TONES } from "@/lib/catalogue";
import { isFitzpatrick } from "@/lib/skinType";
import { UNIT_COST, createBalanceCache } from "@/server/credits";
import type { RouteDeps } from "@/server/deps";
import { jpegSize, stripMetadata } from "@/server/jpeg";
import { LABELS } from "@/server/labels";
import { createLimiter } from "@/server/limits";
import { makeRenderHandler } from "@/server/routes/render";
import { makeSkinTypeHandler } from "@/server/routes/skinType";
import { makeUploadHandler } from "@/server/routes/upload";
import { createYouCam } from "@/server/youcam";

/**
 * HUMAN STEP, run by hand only: `pnpm record:sample` with YOUCAM_API_KEY set. Never part of pnpm test, the live suites
 * or CI. It records the sample face's results ONCE, through the site's own route handlers (upload, skin-type, render:
 * the same code a visitor's tap runs, with its session, limiter and credit floor), so the Try page can show them for
 * the sample face without any YouCam call. It spends real units: one skin type read (10) and one render (1) for each
 * featured bottle at each tone, and refuses before the first paid call when that would leave under FLOOR.
 * It writes the renders to public/sample/renders/ (metadata stripped by the upload route's own stripMetadata, pixels
 * untouched) and the manifest to src/data/sample.json. The key, file ids, task ids and result URLs are never printed
 * or written: only counts, unit balances and error codes are.
 */
const FACE = "public/sample/face.jpg";
const FLOOR = 600;
const ORIGIN = "http://record.local";

/** The date in Atlanta, where the builder records, as YYYY-MM-DD. */
const recordedOn = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

function jpegOrPng(b: Uint8Array): "jpg" | "png" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  return null;
}

test("record the sample face's skin type read and every featured render", { timeout: 1_800_000 }, async () => {
  const key = process.env.YOUCAM_API_KEY ?? "";
  expect(key.length, "YOUCAM_API_KEY is unset; this recorder fails, never skips").toBeGreaterThanOrEqual(16);
  const face = new Uint8Array(readFileSync(FACE));
  const stripped = stripMetadata(face);
  expect(stripped !== null && Buffer.from(stripped).equals(Buffer.from(face)), "the sample face is not already upload-clean").toBe(true);

  const pairs = CATALOGUE.flatMap((b) => TONES.map((t) => ({ bottle: b, tone: t.lStar })));
  const cost = UNIT_COST.skinType + pairs.length * UNIT_COST.render;
  const yc = createYouCam({ key });
  const before = await yc.balance();
  console.log(`units before: ${before}; this run needs at most ${cost}; floor ${FLOOR}`);
  expect(before - cost, `recording would leave ${before - cost} units, under the floor of ${FLOOR}`).toBeGreaterThanOrEqual(FLOOR);

  // Production's own route deps, with a throwaway session secret and the recording floor in place of CREDIT_FLOOR.
  const secret = randomBytes(32).toString("hex");
  const limiter = createLimiter();
  const balance = createBalanceCache();
  const deps = (): RouteDeps => ({
    env: { youcamKey: key, sessionSecret: secret, creditFloor: FLOOR, scanEnabled: false, toneEnabled: false },
    youcam: (k) => createYouCam({ key: k }),
    limiter,
    catalogue: CATALOGUE,
    labels: LABELS,
    balance,
    now: () => Date.now(),
  });
  const upload = makeUploadHandler(deps);
  const skinType = makeSkinTypeHandler(deps);
  const render = makeRenderHandler(deps);
  const post = (path: string, body: unknown, cookie: string) =>
    new Request(`${ORIGIN}${path}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", cookie } });

  /** One upload through the upload route: a fresh session holding the face's file id. */
  async function session(): Promise<{ fileId: string; cookie: string }> {
    const res = await upload(new Request(`${ORIGIN}/api/upload`, { method: "POST", body: face, headers: { "Content-Type": "image/jpeg" } }));
    const body = (await res.json()) as { fileId?: string; error?: { code: string } };
    expect(res.status, `upload refused: ${body.error?.code}`).toBe(200);
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie.length).toBeGreaterThan(0);
    return { fileId: body.fileId as string, cookie };
  }

  const read = await session();
  const skinRes = await skinType(post("/api/skin-type", { fileId: read.fileId }, read.cookie));
  const skin = (await skinRes.json()) as { fitzpatrick?: unknown; error?: { code: string } };
  expect(skinRes.status, `skin type refused: ${skin.error?.code}`).toBe(200);
  expect(isFitzpatrick(skin.fitzpatrick)).toBe(true);
  console.log(`skin type read: Fitzpatrick ${String(skin.fitzpatrick)}`);

  const renders: { bottleId: string; tone: number; colorIntensity: number; predictedBlend: number; src: string; recordedOn: string }[] = [];
  const refused: string[] = [];
  // One session per bottle: five renders each, under the route's 20 renders per session.
  for (const b of CATALOGUE) {
    const s = await session();
    for (const t of TONES) {
      const res = await render(post("/api/render", { fileId: s.fileId, bottleId: b.id, tone: t.lStar }, s.cookie));
      const out = (await res.json()) as { imageUrl?: string; colorIntensity?: number; predictedBlend?: number; error?: { code: string } };
      if (res.status !== 200) {
        refused.push(`${b.id} at L* ${t.lStar}: ${out.error?.code}`);
        continue;
      }
      const img = await fetch(out.imageUrl as string, { signal: AbortSignal.timeout(60_000) });
      expect(img.ok, `render download for ${b.id} at L* ${t.lStar} answered ${img.status}`).toBe(true);
      const raw = new Uint8Array(await img.arrayBuffer());
      const kind = jpegOrPng(raw);
      expect(kind, `render for ${b.id} at L* ${t.lStar} is neither JPEG nor PNG`).not.toBeNull();
      // JPEG only: the upload route's own allowlist strip, which copies the pixels' bytes and drops every other segment.
      const bytes = kind === "jpg" ? stripMetadata(raw) : raw;
      expect(bytes, `render for ${b.id} at L* ${t.lStar} did not survive the metadata strip`).not.toBeNull();
      const src = `/sample/renders/${b.id}-${t.lStar}.${kind}`;
      writeFileSync(`public${src}`, bytes as Uint8Array);
      renders.push({ bottleId: b.id, tone: t.lStar, colorIntensity: out.colorIntensity as number, predictedBlend: out.predictedBlend as number, src, recordedOn });
      console.log(`recorded ${b.id} at L* ${t.lStar} (colorIntensity ${out.colorIntensity}, ${bytes?.length} bytes)`);
    }
  }

  // The face's size, read from its own frame header: the bytes every render above was made from.
  const size = jpegSize(face);
  expect(size).not.toBeNull();
  const manifest = {
    schemaVersion: 1,
    face: { src: "/sample/face.jpg", width: size?.width, height: size?.height },
    skinType: { fitzpatrick: skin.fitzpatrick, recordedOn },
    renders,
  };
  writeFileSync("src/data/sample.json", `${JSON.stringify(manifest, null, 2)}\n`);

  const after = await yc.balance();
  console.log(`units after: ${after}; spent ${before - after}; renders ${renders.length}; refused ${refused.length}`);
  for (const r of refused) console.log(`refused: ${r}`);
  expect(refused).toEqual([]);
});

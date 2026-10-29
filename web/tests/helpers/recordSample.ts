import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Bottle } from "@/lib/catalogue";
import type { Sample } from "@/lib/sample";
import { isFitzpatrick } from "@/lib/skinType";
import { UNIT_COST } from "@/server/credits";
import type { RouteDeps } from "@/server/deps";
import { jpegSize, stripMetadata } from "@/server/jpeg";
import { makeRenderHandler } from "@/server/routes/render";
import { makeSkinTypeHandler } from "@/server/routes/skinType";
import { makeUploadHandler } from "@/server/routes/upload";

const ORIGIN = "http://record.local";

/** A finished recording, held in memory until every task and download has succeeded. Paths are under public/. */
export type SampleRecording = { manifest: Sample; files: Map<string, Uint8Array>; before: number; after: number };

function imageKind(b: Uint8Array): "jpg" | "png" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  return null;
}

/**
 * Records the sample face's skin type read and one render per bottle and tone, through the upload, skin-type and render
 * route handlers themselves (`deps` are the routes' own; the recorder passes production's with the real YouCam
 * client). It starts no task unless the account's balance covers the whole run and stays at or above `floor`. Any
 * refusal, unusable answer or failed download throws, and nothing has been written: the caller publishes only a
 * complete recording (publishSample). Errors name a bottle, a tone, a status or an error code, never a key, file id,
 * task id or URL.
 */
export async function recordSample(o: {
  deps: () => RouteDeps;
  /** The account's balance (a free call). */
  balance: () => Promise<number>;
  download: (url: string) => Promise<Uint8Array>;
  face: Uint8Array;
  bottles: readonly Bottle[];
  tones: readonly number[];
  floor: number;
  recordedOn: string;
  log?: (line: string) => void;
}): Promise<SampleRecording> {
  const log = o.log ?? (() => undefined);
  const stripped = stripMetadata(o.face);
  if (stripped === null || !Buffer.from(stripped).equals(Buffer.from(o.face))) throw new Error("the sample face is not already upload-clean");
  const size = jpegSize(o.face);
  if (!size) throw new Error("the sample face has no readable size");

  const pairs = o.bottles.flatMap((b) => o.tones.map((tone) => ({ bottle: b, tone })));
  const cost = UNIT_COST.skinType + pairs.length * UNIT_COST.render;
  const before = await o.balance();
  if (!(before - cost >= o.floor)) throw new Error(`stopped: ${before} units cannot cover the ${cost} left in this run and stay at or above ${o.floor}`);
  log(`units before: ${before}; this run needs at most ${cost}; floor ${o.floor}`);

  const upload = makeUploadHandler(o.deps);
  const skinType = makeSkinTypeHandler(o.deps);
  const render = makeRenderHandler(o.deps);
  const post = (path: string, body: unknown, cookie: string) =>
    new Request(`${ORIGIN}${path}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", cookie } });
  const codeOf = (body: unknown) => (body as { error?: { code?: unknown } } | null)?.error?.code;

  /** One upload through the upload route: a fresh session holding the face's file id. Uploads are free. */
  async function session(): Promise<{ fileId: string; cookie: string }> {
    const res = await upload(new Request(`${ORIGIN}/api/upload`, { method: "POST", body: o.face as Uint8Array<ArrayBuffer>, headers: { "Content-Type": "image/jpeg" } }));
    const body = (await res.json()) as { fileId?: unknown };
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
    if (res.status !== 200 || typeof body.fileId !== "string" || cookie === "") throw new Error(`upload refused: ${String(codeOf(body))}`);
    return { fileId: body.fileId, cookie };
  }

  const read = await session();
  const skinRes = await skinType(post("/api/skin-type", { fileId: read.fileId }, read.cookie));
  const skin = (await skinRes.json()) as { fitzpatrick?: unknown };
  if (skinRes.status !== 200 || !isFitzpatrick(skin.fitzpatrick)) throw new Error(`skin type refused: ${String(codeOf(skin))}`);
  log(`skin type read: Fitzpatrick ${skin.fitzpatrick}`);

  const files = new Map<string, Uint8Array>();
  const renders: Sample["renders"] = [];
  // One session per bottle, so a run never meets the route's 20 renders per session.
  for (const b of o.bottles) {
    const s = await session();
    for (const tone of o.tones) {
      const res = await render(post("/api/render", { fileId: s.fileId, bottleId: b.id, tone }, s.cookie));
      const out = (await res.json()) as { imageUrl?: unknown; colorIntensity?: unknown; predictedBlend?: unknown };
      const { imageUrl, colorIntensity, predictedBlend } = out;
      if (res.status !== 200 || typeof imageUrl !== "string" || typeof colorIntensity !== "number" || typeof predictedBlend !== "number") {
        throw new Error(`render refused for ${b.id} at L* ${tone}: ${String(codeOf(out))}`);
      }
      const raw = await o.download(imageUrl);
      const kind = imageKind(raw);
      if (!kind) throw new Error(`render for ${b.id} at L* ${tone} is neither JPEG nor PNG`);
      // A JPEG goes through the upload route's own allowlist strip, which keeps the image data and drops every other
      // segment. A PNG is kept as returned.
      const bytes = kind === "jpg" ? stripMetadata(raw) : raw;
      if (!bytes) throw new Error(`render for ${b.id} at L* ${tone} did not survive the metadata strip`);
      const src = `/sample/renders/${b.id}-${tone}.${kind}`;
      files.set(src, bytes);
      renders.push({ bottleId: b.id, tone, colorIntensity, predictedBlend, src, recordedOn: o.recordedOn });
      log(`recorded ${b.id} at L* ${tone} (colorIntensity ${colorIntensity}, ${bytes.length} bytes)`);
    }
  }

  const after = await o.balance();
  log(`units after: ${after}; spent ${before - after}; renders ${renders.length}`);
  const manifest: Sample = {
    schemaVersion: 1,
    face: { src: "/sample/face.jpg", width: size.width, height: size.height },
    skinType: { fitzpatrick: skin.fitzpatrick, recordedOn: o.recordedOn },
    renders,
  };
  return { manifest, files, before, after };
}

/**
 * Publishes a complete recording: every render file, then the manifest, then removes any old render file the new
 * manifest does not list. Called only after recordSample has returned, so a failed run leaves the last recording as it was.
 */
export function publishSample(o: { publicDir: string; manifestPath: string; rec: SampleRecording }): void {
  const dir = join(o.publicDir, "sample", "renders");
  mkdirSync(dir, { recursive: true });
  for (const [src, bytes] of o.rec.files) writeFileSync(join(o.publicDir, src), bytes);
  writeFileSync(o.manifestPath, `${JSON.stringify(o.rec.manifest, null, 2)}\n`);
  const keep = new Set([...o.rec.files.keys()].map((src) => src.replace("/sample/renders/", "")));
  for (const f of readdirSync(dir)) if (!keep.has(f)) rmSync(join(dir, f));
}

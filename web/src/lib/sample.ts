import { z } from "zod";
import sampleJson from "@/data/sample.json";
import type { PreparedImage } from "@/lib/image";
import { FITZPATRICK, type Fitzpatrick } from "@/lib/skinType";
import type { RenderResult } from "@/lib/types";

/**
 * The sample face: the builder's own selfie (shown with his consent), and its results recorded once with the real
 * YouCam APIs through the site's own route handlers (tests/record/sample.record.test.ts). With it the Try page shows a
 * recorded skin type read and a recorded render for each featured bottle at each tone, with no YouCam call, upload or
 * unit spent, and says so on screen. Any other label needs a live render on the visitor's own selfie.
 */
const IsoDate = z.iso.date();

export const SampleSchema = z.object({
  schemaVersion: z.literal(1),
  face: z.object({ src: z.literal("/sample/face.jpg"), width: z.number().int().positive(), height: z.number().int().positive() }),
  skinType: z.object({ fitzpatrick: z.enum(FITZPATRICK), recordedOn: IsoDate }),
  renders: z.array(
    z.object({
      bottleId: z.string().regex(/^[a-z0-9-]{2,64}$/),
      tone: z.number(),
      colorIntensity: z.number().int().min(0).max(100),
      predictedBlend: z.number(),
      src: z.string().regex(/^\/sample\/renders\/[a-z0-9-]+\.(jpg|png)$/),
      recordedOn: IsoDate,
    }),
  ),
});

export type Sample = z.infer<typeof SampleSchema>;

/** Parses the manifest. Throws on another version, a bad entry, or two recordings of one bottle at one tone. */
export function loadSample(raw: unknown): Sample {
  const s = SampleSchema.parse(raw);
  const seen = new Set<string>();
  for (const r of s.renders) {
    const k = `${r.bottleId}@${r.tone}`;
    if (seen.has(k)) throw new Error(`two recordings of ${k}`);
    seen.add(k);
  }
  return s;
}

export const SAMPLE: Sample = loadSample(sampleJson);

/** Shown when a label with no recording is picked on the sample face. */
export const SAMPLE_LIVE_LINE = "Live render needs your own selfie.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A YYYY-MM-DD date as "Oct 29, 2026", the same on the server and in every browser. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** The label on every recorded render. */
export function recordedRenderLine(recordedOn: string): string {
  return `Recorded render (YouCam Makeup VTO, ${shortDate(recordedOn)})`;
}

/** The line under the tones once the sample face's recorded skin type read is shown. */
export function recordedReadLine(fitzpatrick: Fitzpatrick, recordedOn: string): string {
  return `Recorded read (YouCam Fitzpatrick Skin Type, ${shortDate(recordedOn)}): type ${fitzpatrick}. We picked the closest tone; change it if it looks off.`;
}

/** The recorded render of `bottleId` at `tone` as a RenderResult, or null when there is none. It never expires. */
export function sampleRender(s: Sample, bottleId: string, tone: number): RenderResult | null {
  const r = s.renders.find((x) => x.bottleId === bottleId && x.tone === tone);
  if (!r) return null;
  return {
    imageUrl: r.src,
    bottleId: r.bottleId,
    colorIntensity: r.colorIntensity,
    predictedBlend: r.predictedBlend,
    expiresAt: Number.MAX_SAFE_INTEGER,
    recordedOn: r.recordedOn,
  };
}

/** Fetches the sample face (already prepared exactly as the upload path prepares a photo) as a PreparedImage. */
export async function loadSampleFace(
  s: Sample = SAMPLE,
  f: typeof fetch = fetch,
  objectUrl: (b: Blob) => string = (b) => URL.createObjectURL(b),
): Promise<PreparedImage> {
  const res = await f(s.face.src);
  if (!res.ok) throw new Error(`the sample face answered ${res.status}`);
  const blob = await res.blob();
  if (blob.type !== "image/jpeg") throw new Error("the sample face is not a JPEG");
  return { blob, width: s.face.width, height: s.face.height, url: objectUrl(blob), sample: true };
}

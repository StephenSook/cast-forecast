import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { afterAll, expect, test } from "vitest";
import { POLL_SKIN_TYPE, POLL_VTO, PUT, REGISTER, RUN_SKIN_TYPE, RUN_VTO, registerReply } from "../helpers/constants";
import { testEntry } from "../helpers/entries";
import { jsonReply } from "../helpers/fakeFetch";
import { makePng, pngIntact } from "../helpers/png";
import { type SampleRecording, publishSample, recordSample } from "../helpers/recordSample";
import { testDeps } from "../helpers/routes";

// The sample recorder, offline: the real route handlers over a scripted YouCam, so a refusal, a failed download and
// spending elsewhere on the account can be injected without a key or a unit.
const face = new Uint8Array(readFileSync("public/sample/face.jpg"));
const PNG = makePng(24, 32);
const vtoOk = jsonReply(200, { data: { task_status: "success", results: { url: "https://out.example/r.png" } } });
const routes = (poll: Response | Response[] = vtoOk) => ({
  [REGISTER]: registerReply("file-1"),
  [PUT]: new Response(null, { status: 200 }), // no body: a clone's body cancel would wait on the unread original
  [RUN_SKIN_TYPE]: jsonReply(200, { data: { task_id: "t3" } }),
  [POLL_SKIN_TYPE]: jsonReply(200, { data: { task_status: "success", results: { fitzpatrick_scale: "IV" } } }),
  [RUN_VTO]: jsonReply(200, { data: { task_id: "t1" } }),
  [POLL_VTO]: poll,
});

function setup(o: { poll?: Response | Response[]; balances?: number[]; download?: (url: string) => Promise<Uint8Array> } = {}) {
  const { deps, ff } = testDeps({ catalogue: [testEntry()], balance: 1000, routes: routes(o.poll) });
  const balances = [...(o.balances ?? [])];
  const downloads: string[] = [];
  const run = () =>
    recordSample({
      deps,
      balance: async () => (balances.length > 1 ? (balances.shift() as number) : (balances[0] ?? 1000)),
      download: o.download ?? (async (url) => { downloads.push(url); return PNG; }),
      face,
      bottles: [testEntry()],
      tones: [55, 60],
      floor: 600,
      recordedOn: "2026-10-29",
    });
  return { ff, run, downloads };
}

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

/** A public folder and manifest holding an earlier recording, to show a failed run leaves it untouched. */
function earlier(): { publicDir: string; manifestPath: string; old: string } {
  const root = mkdtempSync(join(tmpdir(), "cf-sample-"));
  roots.push(root);
  const publicDir = join(root, "public");
  mkdirSync(join(publicDir, "sample", "renders"), { recursive: true });
  writeFileSync(join(publicDir, "sample", "renders", "test-a-55.png"), "old render");
  writeFileSync(join(root, "sample.json"), "old manifest");
  return { publicDir, manifestPath: join(root, "sample.json"), old: "old render" };
}

test("records the read and every pair through the routes, and returns the whole recording", async () => {
  const { ff, run, downloads } = setup();
  const rec = await run();
  expect(ff.taskStarts()).toBe(3);
  expect(downloads).toEqual(["https://out.example/r.png", "https://out.example/r.png"]);
  expect(rec.manifest.skinType).toEqual({ fitzpatrick: "IV", recordedOn: "2026-10-29" });
  expect(rec.manifest.renders.map((r) => [r.bottleId, r.tone, r.colorIntensity, r.src])).toEqual([
    ["test-a", 55, 49, "/sample/renders/test-a-55.png"],
    ["test-a", 60, 49, "/sample/renders/test-a-60.png"],
  ]);
  expect([...rec.files.keys()]).toEqual(["/sample/renders/test-a-55.png", "/sample/renders/test-a-60.png"]);
  expect(rec.manifest.face).toEqual({ src: "/sample/face.jpg", width: 697, height: 1079 });
});

test("a refused render throws, and the earlier recording stays exactly as it was", async () => {
  const refused = jsonReply(200, { data: { task_status: "error", error: "error_face_position_invalid" } });
  const { ff, run } = setup({ poll: [vtoOk, refused] });
  const dir = earlier();
  let published = false;
  const attempt = async () => {
    const rec: SampleRecording = await run();
    publishSample({ ...dir, rec });
    published = true;
  };
  await expect(attempt()).rejects.toThrow("render refused for test-a at L* 60: face_position");
  expect(published).toBe(false);
  expect(ff.taskStarts()).toBe(3);
  expect(readFileSync(join(dir.publicDir, "sample", "renders", "test-a-55.png"), "utf8")).toBe(dir.old);
  expect(readFileSync(dir.manifestPath, "utf8")).toBe("old manifest");
});

test("spending elsewhere on the account stops the run before the next paid call", async () => {
  // Before the run, before the read and before the first render the balance covers what is left; then another spender
  // takes it to 600, which cannot pay the last render (1 unit) and stay at the 600 floor. A cached balance would not see it.
  const { ff, run } = setup({ balances: [1000, 1000, 1000, 600] });
  await expect(run()).rejects.toThrow("stopped: 600 units cannot cover the 1 left in this run and stay at or above 600");
  expect(ff.taskStarts()).toBe(2);
});

test("a run that would end under the floor starts no task at all", async () => {
  const { ff, run } = setup({ balances: [611] }); // 12 units needed: 611 - 12 = 599
  await expect(run()).rejects.toThrow(/^stopped: 611 units cannot cover the 12/);
  expect(ff.taskStarts()).toBe(0);
});

test("a download that is not an image throws, naming the bottle and tone but no URL or id", async () => {
  const { run } = setup({ download: async () => new TextEncoder().encode("<html>expired</html>") });
  const err = await run().then(
    () => null,
    (e: unknown) => e as Error,
  );
  expect(err?.message).toBe("render for test-a at L* 55 is neither JPEG nor PNG");
  for (const secret of ["file-1", "t1", "out.example"]) expect(err?.message).not.toContain(secret);
});

test("a truncated PNG download is refused even though it still starts like a PNG", async () => {
  // A real recorded render cut to 60 000 bytes: the signature and IHDR are intact, an IDAT chunk runs past the end.
  const real = new Uint8Array(readFileSync("public/sample/renders/cetaphil-sheer-mineral-face-55.png"));
  const cut = real.subarray(0, 60_000);
  expect(pngIntact(real)).toEqual({ width: 696, height: 1080 }); // the check passes a whole render: not vacuous
  expect(pngIntact(cut)).toBeNull();
  const { run } = setup({ download: async () => cut });
  await expect(run()).rejects.toThrow("render for test-a at L* 55 is a damaged PNG");
});

test("a PNG whose chunks are whole but whose image data is short is refused", () => {
  const ok = makePng(24, 32);
  expect(pngIntact(ok)).toEqual({ width: 24, height: 32 });
  const flipped = new Uint8Array(ok);
  flipped[44] ^= 0xff; // inside IDAT's data (IHDR ends at 33, IDAT's data starts at 41): its CRC no longer matches
  expect(pngIntact(flipped)).toBeNull();
  // Declares 33 rows but carries data for 32, with every CRC correct.
  expect(pngIntact(withHeight(ok, 33))).toBeNull();
});

test("a PNG with every CRC correct but an undefined row filter does not decode and is refused", async () => {
  for (const filter of [0, 1, 2, 3, 4]) expect(pngIntact(makePng(24, 32, undefined, filter)), `filter ${filter}`).toEqual({ width: 24, height: 32 });
  const bad = makePng(24, 32, undefined, 255);
  expect(pngIntact(bad)).toBeNull();
  const { run } = setup({ download: async () => bad });
  await expect(run()).rejects.toThrow("render for test-a at L* 55 is a damaged PNG");
});

/** The PNG with IHDR's height rewritten and its CRC recomputed, so only the image data disagrees. */
function withHeight(png: Uint8Array, h: number): Uint8Array {
  const out = Buffer.from(png);
  out.writeUInt32BE(h, 8 + 8 + 4);
  out.writeUInt32BE(crc32(out.subarray(8 + 4, 8 + 8 + 13)), 8 + 8 + 13);
  return new Uint8Array(out);
}

test("publishing writes every render, then the manifest, and removes renders the manifest no longer lists", async () => {
  const { run } = setup();
  const rec = await run();
  const dir = earlier();
  writeFileSync(join(dir.publicDir, "sample", "renders", "gone-bottle-45.png"), "stale");
  publishSample({ ...dir, rec });
  expect(readdirSync(join(dir.publicDir, "sample", "renders")).sort()).toEqual(["test-a-55.png", "test-a-60.png"]);
  expect(new Uint8Array(readFileSync(join(dir.publicDir, "sample", "renders", "test-a-60.png")))).toEqual(PNG);
  expect(JSON.parse(readFileSync(dir.manifestPath, "utf8"))).toEqual(rec.manifest);
  expect(readdirSync(join(dir.publicDir, "sample"))).toEqual(["renders"]); // no staging folder left behind
  expect(existsSync(`${dir.manifestPath}.next`)).toBe(false);
});

// Writes 1 and 2 are the two renders, write 3 the manifest: a disk that fills at any of them changes nothing published.
test.each([1, 2, 3])("a write that fails at write %i leaves the earlier recording and manifest exactly as they were", async (failAt) => {
  const { run } = setup();
  const rec = await run();
  const dir = earlier();
  let writes = 0;
  const write = (p: string, d: Uint8Array | string) => {
    if (++writes === failAt) throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    writeFileSync(p, d);
  };
  expect(() => publishSample({ ...dir, rec, write })).toThrow("ENOSPC");
  expect(writes).toBe(failAt);
  expectEarlierIntact(dir);
});

// Rename 1 sets the old folder aside, rename 2 installs the new one, rename 3 replaces the manifest: a failure at any
// of them is undone, so the earlier folder and manifest are back.
test.each([1, 2, 3])("a rename that fails at rename %i is undone, leaving the earlier recording and manifest in place", async (failAt) => {
  const { run } = setup();
  const rec = await run();
  const dir = earlier();
  let renames = 0;
  const rename = (from: string, to: string) => {
    if (++renames === failAt) throw Object.assign(new Error("EIO: i/o error, rename"), { code: "EIO" });
    renameSync(from, to);
  };
  expect(() => publishSample({ ...dir, rec, rename })).toThrow("EIO");
  expect(renames).toBe(failAt);
  expectEarlierIntact(dir);
});

function expectEarlierIntact(dir: ReturnType<typeof earlier>): void {
  expect(readdirSync(join(dir.publicDir, "sample"))).toEqual(["renders"]);
  expect(readdirSync(join(dir.publicDir, "sample", "renders"))).toEqual(["test-a-55.png"]);
  expect(readFileSync(join(dir.publicDir, "sample", "renders", "test-a-55.png"), "utf8")).toBe(dir.old);
  expect(readFileSync(dir.manifestPath, "utf8")).toBe("old manifest");
  expect(existsSync(`${dir.manifestPath}.next`)).toBe(false);
}

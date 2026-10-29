import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { POLL_SKIN_TYPE, POLL_VTO, PUT, REGISTER, RUN_SKIN_TYPE, RUN_VTO, registerReply } from "../helpers/constants";
import { testEntry } from "../helpers/entries";
import { jsonReply } from "../helpers/fakeFetch";
import { type SampleRecording, publishSample, recordSample } from "../helpers/recordSample";
import { testDeps } from "../helpers/routes";

// The sample recorder, offline: the real route handlers over a scripted YouCam, so a refusal, a failed download and
// spending elsewhere on the account can be injected without a key or a unit.
const face = new Uint8Array(readFileSync("public/sample/face.jpg"));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
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

test("publishing writes every render, then the manifest, and removes renders the manifest no longer lists", async () => {
  const { run } = setup();
  const rec = await run();
  const dir = earlier();
  writeFileSync(join(dir.publicDir, "sample", "renders", "gone-bottle-45.png"), "stale");
  publishSample({ ...dir, rec });
  expect(readdirSync(join(dir.publicDir, "sample", "renders")).sort()).toEqual(["test-a-55.png", "test-a-60.png"]);
  expect(new Uint8Array(readFileSync(join(dir.publicDir, "sample", "renders", "test-a-60.png")))).toEqual(PNG);
  expect(JSON.parse(readFileSync(dir.manifestPath, "utf8"))).toEqual(rec.manifest);
});

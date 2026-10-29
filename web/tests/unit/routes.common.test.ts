import { afterEach, expect, test, vi } from "vitest";
import { guarded } from "@/server/routes/common";
import { makeCreditsHandler } from "@/server/routes/credits";
import { makeRenderHandler } from "@/server/routes/render";
import { makeUploadHandler } from "@/server/routes/upload";
import { YouCamError } from "@/server/youcam";
import { POLL_VTO, RUN_VTO } from "../helpers/constants";
import { testEntry } from "../helpers/entries";
import { jsonReply } from "../helpers/fakeFetch";
import { fakeJpeg } from "../helpers/fakeJpeg";
import { cookieFor, get, jpegPost, jsonPost, testDeps } from "../helpers/routes";

// Fix round 1 items 3 and 4: an unexpected failure is logged by name (and a YouCamError code), never by message,
// because a message can carry a file id, a task id or a poll path.
const ID = "Tk_9f8e7d6c5b4a3210";
const leaky = () => new TypeError(`fetch failed for file-1 at /s2s/v2.0/task/makeup-vto/${ID}`);
const logged = () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  return { spy, lines: () => spy.mock.calls.map((c) => c.map(String).join(" ")) };
};
afterEach(() => { vi.restoreAllMocks(); });

const expectNameOnly = (lines: string[], route: string, name: string) => {
  expect(lines).toEqual([`[api/${route}] unexpected failure: ${name}`]);
  for (const bad of ["file-1", ID, "/s2s/", "fetch failed"]) expect(lines[0]).not.toContain(bad);
};

test("upload: a non-YouCam throw from the client is 502 and logs only its name", async () => {
  const log = logged();
  const t = testDeps();
  const deps = () => ({ ...t.deps(), youcam: (key: string) => ({ ...t.deps().youcam(key), upload: async () => { throw leaky(); } }) });
  const res = await makeUploadHandler(deps)(jpegPost(fakeJpeg(640, 480)));
  expect(res.status).toBe(502); expect((await res.json()).error.code).toBe("upstream");
  expectNameOnly(log.lines(), "upload", "TypeError");
});
test("credits: a non-YouCam throw from the balance read is 502 and logs only its name", async () => {
  const log = logged();
  const t = testDeps();
  const deps = () => ({ ...t.deps(), balance: { ...t.deps().balance, get: async () => { throw leaky(); } } });
  const res = await makeCreditsHandler(deps)(get("/api/credits"));
  expect(res.status).toBe(502);
  expectNameOnly(log.lines(), "credits", "TypeError");
});
// Controller follow-up to finding A: a non-YouCam throw is not a confirmed refusal, so the unit stays spent.
test("render: a non-YouCam throw from the task start is 502, keeps its unit, and logs only its name", async () => {
  const log = logged();
  const t = testDeps({ catalogue: [testEntry()], balance: 879 });
  const deps = () => ({ ...t.deps(), youcam: (key: string) => ({ ...t.deps().youcam(key), run: async () => { throw leaky(); } }) });
  const res = await makeRenderHandler(deps)(jsonPost("/api/render", { fileId: "file-1", bottleId: "test-a", tone: 55 }, cookieFor(["file-1"])));
  expect(res.status).toBe(502);
  expectNameOnly(log.lines(), "render", "TypeError");
  expect((await (await makeCreditsHandler(t.deps)(get("/api/credits"))).json()).balance).toBe(878);
});
test("render: a YouCamError from the task start refunds only when it carries a 4xx status", async () => {
  const cases: [YouCamError, number][] = [
    [new YouCamError("refused", "http_400", { status: 400 }), 879],
    [new YouCamError("refused", "http_499", { status: 499 }), 879],
    [new YouCamError("down", "http_500", { status: 500 }), 878],
    [new YouCamError("odd", "http_399", { status: 399 }), 878],
    [new YouCamError("no status", "network"), 878],
    [new YouCamError("bad id", "bad_shape"), 878],
  ];
  for (const [thrown, want] of cases) {
    const t = testDeps({ catalogue: [testEntry()], balance: 879 });
    const deps = () => ({ ...t.deps(), youcam: (key: string) => ({ ...t.deps().youcam(key), run: async () => { throw thrown; } }) });
    expect((await makeRenderHandler(deps)(jsonPost("/api/render", { fileId: "file-1", bottleId: "test-a", tone: 55 }, cookieFor(["file-1"])))).status).not.toBe(200);
    expect((await (await makeCreditsHandler(t.deps)(get("/api/credits"))).json()).balance, thrown.code).toBe(want);
  }
});
test("render: a non-YouCam throw from the poll, after YouCam accepted the task, is 502 and its unit stays spent", async () => {
  const log = logged();
  const t = testDeps({ catalogue: [testEntry()], balance: 879, routes: { [RUN_VTO]: jsonReply(200, { data: { task_id: "t1" } }) } });
  const deps = () => ({ ...t.deps(), youcam: (key: string) => ({ ...t.deps().youcam(key), poll: async () => { throw leaky(); } }) });
  const res = await makeRenderHandler(deps)(jsonPost("/api/render", { fileId: "file-1", bottleId: "test-a", tone: 55 }, cookieFor(["file-1"])));
  expect(res.status).toBe(502);
  expectNameOnly(log.lines(), "render", "TypeError");
  expect((await (await makeCreditsHandler(t.deps)(get("/api/credits"))).json()).balance).toBe(878);
});
test("youcamFor: a non-YouCam throw building the client is 503 not_configured and logs only its name", async () => {
  const log = logged();
  const t = testDeps();
  const deps = () => ({ ...t.deps(), youcam: () => { throw leaky(); } });
  const res = await makeCreditsHandler(deps)(get("/api/credits"));
  expect(res.status).toBe(503); expect((await res.json()).error.code).toBe("not_configured");
  expectNameOnly(log.lines(), "credits", "TypeError");
});
test("an expected YouCam failure (a face error) is answered and not logged", async () => {
  const log = logged();
  const { deps } = testDeps({ catalogue: [testEntry()], balance: 879, routes: { [RUN_VTO]: jsonReply(200, { data: { task_id: "t1" } }),
    [POLL_VTO]: jsonReply(200, { data: { task_status: "error", error: "error_face_angle_invalid" } }) } });
  expect((await makeRenderHandler(deps)(jsonPost("/api/render", { fileId: "file-1", bottleId: "test-a", tone: 55 }, cookieFor(["file-1"])))).status).toBe(422);
  expect(log.spy).not.toHaveBeenCalled();
});

test("guarded logs a YouCamError by name and code, never its message (which can carry the task id)", async () => {
  const log = logged();
  const e = new YouCamError(`task did not finish within 50000 ms at /s2s/v2.0/task/makeup-vto/${ID}`, "timeout", { taskId: ID });
  const res = await guarded("render", async () => { throw e; })(new Request("https://cf.test/api/render"));
  expect(res.status).toBe(502); expect((await res.json()).error.code).toBe("upstream");
  expect(log.lines()).toEqual(["[api/render] unexpected failure: YouCamError code=timeout"]);
  expect(log.lines()[0]).not.toContain(ID);
});
test("guarded logs any other throw by name only; a name or code that is not a plain identifier is not echoed", async () => {
  const log = logged();
  const odd = Object.assign(new Error("x"), { name: `Bad name ${ID}` });
  const oddCode = new YouCamError("x", `has space ${ID}`);
  for (const thrown of [leaky(), odd, oddCode, `a string with ${ID}`]) {
    expect((await guarded("tone", async () => { throw thrown; })(new Request("https://cf.test/api/tone"))).status).toBe(502);
  }
  expect(log.lines()).toEqual([
    "[api/tone] unexpected failure: TypeError",
    "[api/tone] unexpected failure: Error",
    "[api/tone] unexpected failure: YouCamError",
    "[api/tone] unexpected failure: string",
  ]);
  for (const line of log.lines()) expect(line).not.toContain(ID);
});
test("guarded answers an ApiErrorBody when deps() itself throws", async () => {
  const log = logged();
  const res = await makeUploadHandler(() => { throw leaky(); })(jpegPost(fakeJpeg(640, 480)));
  expect(res.status).toBe(502); expect((await res.json()).error.code).toBe("upstream");
  expectNameOnly(log.lines(), "upload", "TypeError");
});

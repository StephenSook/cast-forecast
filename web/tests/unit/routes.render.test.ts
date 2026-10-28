import { expect, test } from "vitest";
import * as renderRoute from "@/app/api/render/route";
import { MESSAGES } from "@/lib/messages";
import { mapYouCamError } from "@/server/errors";
import { makeupVtoPayload } from "@/server/payload";
import { makeCreditsHandler } from "@/server/routes/credits";
import { makeRenderHandler } from "@/server/routes/render";
import { JSON_TIMEOUT_MS, YouCamError, createYouCam } from "@/server/youcam";
import { CREDIT, NOW, POLL_VTO, RUN_VTO } from "../helpers/constants";
import { testEntry } from "../helpers/entries";
import { jsonReply } from "../helpers/fakeFetch";
import { cookieFor, get, jsonPost, taskRouteWorstCase, testDeps } from "../helpers/routes";

const okRender = { [RUN_VTO]: jsonReply(200, { data: { task_id: "t1" } }),
  [POLL_VTO]: jsonReply(200, { data: { task_status: "success", results: { url: "https://out.example/r.png" } } }) };
const renderReq = (cookie = cookieFor(["file-1"])) => jsonPost("/api/render", { fileId: "file-1", bottleId: "test-a" }, cookie);

test("render sends the K1b-mapped payload for blend 0.169", async () => {
  const { deps, ff } = testDeps({ catalogue: [testEntry()], balance: 879, routes: okRender });
  const res = await makeRenderHandler(deps)(renderReq());
  expect(res.status).toBe(200);
  expect(JSON.parse(ff.calls.find((c) => c.url.endsWith("/task/makeup-vto"))!.body as string)).toEqual(makeupVtoPayload("file-1", "#FFFFFF", 49));
  const body = await res.json();
  expect(body).toMatchObject({ bottleId: "test-a", colorIntensity: 49, imageUrl: "https://out.example/r.png", expiresAt: NOW + 6_900_000 });
  expect(body.predictedBlend).toBeCloseTo(0.16971764011555973, 12);
});
test("render refuses a fileId this session did not upload with 401 session_missing and starts no task", async () => {
  const { deps, ff } = testDeps({ catalogue: [testEntry()], balance: 879, routes: okRender });
  const res = await makeRenderHandler(deps)(renderReq(cookieFor(["file-9"])));
  expect(res.status).toBe(401); expect((await res.json()).error.code).toBe("session_missing"); expect(ff.taskStarts()).toBe(0);
});
test("render answers 404 unknown_bottle against an empty catalogue", async () => {
  const { deps, ff } = testDeps({ balance: 879 });
  const res = await makeRenderHandler(deps)(renderReq());
  expect(res.status).toBe(404); expect((await res.json()).error.code).toBe("unknown_bottle"); expect(ff.taskStarts()).toBe(0);
});
test("render starts no task under the floor", async () => {                        // Review Focus 5
  const { deps, ff } = testDeps({ catalogue: [testEntry()], balance: 100, routes: okRender });
  const res = await makeRenderHandler(deps)(renderReq());
  expect(res.status).toBe(503); expect((await res.json()).error.code).toBe("credits_low"); expect(ff.taskStarts()).toBe(0);
});
test.each(["error_face_position_invalid", "error_face_position_out_of_boundary", "error_face_position_too_small", "error_face_angle_invalid"])(
  "render maps each face error to 422 with its line (%s)", async (code) => {            // Review Focus 4; makeup_vto.yaml:1279-1288
    const { deps, ff } = testDeps({ catalogue: [testEntry()], balance: 879, routes: { [RUN_VTO]: jsonReply(200, { data: { task_id: "t1" } }),
      [POLL_VTO]: jsonReply(200, { data: { task_status: "error", error: code } }) } });
    const res = await makeRenderHandler(deps)(renderReq());
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe(MESSAGES[mapYouCamError(new YouCamError("x", code)).code]);
    expect(ff.taskStarts()).toBe(1);                                                     // no retry
  });
test("render maps YouCam HTTP 429 to 503 busy with Retry-After 30 and no retry", async () => {
  const { deps, ff } = testDeps({ catalogue: [testEntry()], balance: 879, routes: { [RUN_VTO]: new Response("", { status: 429 }) } });
  const res = await makeRenderHandler(deps)(renderReq());
  expect(res.status).toBe(503); expect(res.headers.get("retry-after")).toBe("30");
  expect((await res.json()).error.code).toBe("busy"); expect(ff.taskStarts()).toBe(1);
});
test("render answers 504 timeout when the poll deadline passes", async () => {
  const { deps, ff } = testDeps({ catalogue: [testEntry()], balance: 879, routes: { [RUN_VTO]: jsonReply(200, { data: { task_id: "t1" } }),
    [POLL_VTO]: jsonReply(200, { data: { task_status: "running" } }) } });
  const res = await makeRenderHandler(deps)(renderReq());
  expect(res.status).toBe(504); expect((await res.json()).error.code).toBe("timeout"); expect(ff.taskStarts()).toBe(1);
});
test("render requires content-type application/json and a valid body", async () => {
  const { deps } = testDeps({ catalogue: [testEntry()], balance: 879 });
  const text = new Request("https://cf.test/api/render", { method: "POST", body: "{}", headers: { "Content-Type": "text/plain", cookie: cookieFor(["file-1"]) } });
  expect((await makeRenderHandler(deps)(text)).status).toBe(400);
  const bad = await makeRenderHandler(deps)(jsonPost("/api/render", { fileId: 1 }, cookieFor(["file-1"])));
  expect(bad.status).toBe(400); expect((await bad.json()).error.code).toBe("bad_request");
});

// Beyond the brief.
const balanceAfter = async (deps: ReturnType<typeof testDeps>["deps"], clock: { now: number }) => {
  clock.now = NOW;                                                                       // inside the 30 s cache: reads the held value, not a fresh one
  return (await (await makeCreditsHandler(deps)(get("/api/credits"))).json()).balance;
};
test.each([
  ["a face error", { [RUN_VTO]: jsonReply(200, { data: { task_id: "t1" } }), [POLL_VTO]: jsonReply(200, { data: { task_status: "error", error: "error_face_angle_invalid" } }) }],
  ["an upstream 429", { [RUN_VTO]: new Response("", { status: 429 }) }],
  ["a poll timeout", { [RUN_VTO]: jsonReply(200, { data: { task_id: "t1" } }), [POLL_VTO]: jsonReply(200, { data: { task_status: "running" } }) }],
  ["a network failure", { [RUN_VTO]: new TypeError("fetch failed") }],
  ["a task start with no usable id", { [RUN_VTO]: jsonReply(200, { data: { task_id: "../x" } }) }],
])("carry 1: the held unit is refunded after %s (balance back to 879)", async (_why, routes) => {
  const { deps, ff, clock } = testDeps({ catalogue: [testEntry()], balance: 879, routes });
  expect((await makeRenderHandler(deps)(renderReq())).status).not.toBe(200);
  expect(await balanceAfter(deps, clock)).toBe(879);
  expect(ff.calls.filter((c) => c.url.endsWith("/client/credit"))).toHaveLength(1);
});
test("carry 1: the unit is held before the task starts, so a second render at the floor edge starts nothing", async () => {
  const { deps, ff } = testDeps({ catalogue: [testEntry()], balance: 101, routes: okRender });
  const h = makeRenderHandler(deps);
  const [a, b] = await Promise.all([h(renderReq()), h(renderReq())]);
  expect([a.status, b.status].sort()).toEqual([200, 503]);
  expect(ff.taskStarts()).toBe(1);
});
test("a succeeded task with an unusable url is 502 upstream and its unit stays spent", async () => {
  const { deps, clock } = testDeps({ catalogue: [testEntry()], balance: 879, routes: { [RUN_VTO]: jsonReply(200, { data: { task_id: "t1" } }),
    [POLL_VTO]: jsonReply(200, { data: { task_status: "success", results: { url: "javascript:alert(1)" } } }) } });
  const res = await makeRenderHandler(deps)(renderReq());
  expect(res.status).toBe(502); expect((await res.json()).error.code).toBe("upstream");
  expect(await balanceAfter(deps, clock)).toBe(878);
});
test("a failed balance read is mapped and starts no task", async () => {
  const { deps, ff } = testDeps({ catalogue: [testEntry()], routes: { ...okRender, [CREDIT]: new Response("", { status: 500 }) } });
  const res = await makeRenderHandler(deps)(renderReq());
  expect(res.status).toBe(502); expect((await res.json()).error.code).toBe("upstream"); expect(ff.taskStarts()).toBe(0);
});
test("carry 4: a bottle whose blend the K1b curve cannot reach is 404 unknown_bottle before any YouCam call", async () => {
  const { deps, ff } = testDeps({ catalogue: [testEntry({ render: { paletteHex: "#FFFFFF", blend: 0.5 } })], balance: 879, routes: okRender });
  const res = await makeRenderHandler(deps)(renderReq());
  expect(res.status).toBe(404); expect((await res.json()).error.code).toBe("unknown_bottle"); expect(ff.calls).toEqual([]);
});
test("carry 4: an unknown bottle id makes zero fetch calls", async () => {
  const { deps, ff } = testDeps({ catalogue: [testEntry()], balance: 879, routes: okRender });
  const res = await makeRenderHandler(deps)(jsonPost("/api/render", { fileId: "file-1", bottleId: "test-z" }, cookieFor(["file-1"])));
  expect(res.status).toBe(404); expect(ff.calls).toEqual([]);
});
test("a missing or tampered cookie is 401 session_missing with no call", async () => {
  const { deps, ff } = testDeps({ catalogue: [testEntry()], balance: 879, routes: okRender });
  const good = cookieFor(["file-1"]);
  const tampered = good.slice(0, -1) + (good.endsWith("A") ? "B" : "A");                    // always a different last signature char
  for (const cookie of [undefined, "cf_session=bad.sig", tampered]) {
    const res = await makeRenderHandler(deps)(jsonPost("/api/render", { fileId: "file-1", bottleId: "test-a" }, cookie));
    expect(res.status).toBe(401);
  }
  expect(ff.calls).toEqual([]);
});
test("a deploy key the client refuses is 503 not_configured, never 502", async () => {
  const t = testDeps({ catalogue: [testEntry()], balance: 879, routes: okRender });
  const deps = () => ({ ...t.deps(), youcam: () => { throw new YouCamError("key contains characters outside printable ASCII", "bad_key"); } });
  const res = await makeRenderHandler(deps)(renderReq());
  expect(res.status).toBe(503); expect((await res.json()).error.code).toBe("not_configured"); expect(t.ff.calls).toEqual([]);
});
test("render accepts application/json with a charset, and refuses malformed or oversized JSON with 400", async () => {
  const { deps } = testDeps({ catalogue: [testEntry()], balance: 879, routes: okRender });
  const h = makeRenderHandler(deps);
  const post = (body: string, type = "application/json") =>
    h(new Request("https://cf.test/api/render", { method: "POST", body, headers: { "Content-Type": type, cookie: cookieFor(["file-1"]) } }));
  expect((await post(JSON.stringify({ fileId: "file-1", bottleId: "test-a" }), "application/json; charset=utf-8")).status).toBe(200);
  expect((await post("{not json")).status).toBe(400);
  expect((await post(JSON.stringify({ fileId: "file-1", bottleId: "test-a", pad: "x".repeat(10_000) }))).status).toBe(400);
  expect((await post(JSON.stringify({ fileId: "", bottleId: "test-a" }))).status).toBe(400);
});
test("successful render responses are not cached", async () => {
  const { deps } = testDeps({ catalogue: [testEntry()], balance: 879, routes: okRender });
  expect((await makeRenderHandler(deps)(renderReq())).headers.get("cache-control")).toBe("no-store");
});

// Carry 2: maxDuration covers the route's worst case (see taskRouteWorstCase).
const { pollIntervalMs, worstMs: WORST_CASE_MS } = taskRouteWorstCase();
test("carry 2: render route config is nodejs and maxDuration 120, at least 10 s above the worst case", () => {
  expect(pollIntervalMs).toBe(2000);
  expect(WORST_CASE_MS).toBe(97_000);
  expect(renderRoute.runtime).toBe("nodejs");
  expect(renderRoute.maxDuration).toBe(120);
  expect(renderRoute.maxDuration * 1000).toBeGreaterThanOrEqual(WORST_CASE_MS + 10_000);
  expect(typeof renderRoute.POST).toBe("function");
});
test("carry 2: with every YouCam call taking its full timeout, the route still answers inside the worst case and refunds", async () => {
  const t = testDeps({ catalogue: [testEntry()], balance: 879, routes: { [RUN_VTO]: jsonReply(200, { data: { task_id: "t1" } }),
    [POLL_VTO]: jsonReply(200, { data: { task_status: "running" } }) } });
  const slow: typeof fetch = async (input, init) => { t.clock.now += JSON_TIMEOUT_MS; return t.ff.fetch(input, init); };
  const deps = () => ({ ...t.deps(), youcam: (key: string) =>
    createYouCam({ key, fetch: slow, sleep: async (ms) => { t.clock.now += ms; }, now: () => t.clock.now }) });
  const res = await makeRenderHandler(deps)(renderReq());
  expect(res.status).toBe(504);
  expect(t.clock.now - NOW).toBeLessThanOrEqual(WORST_CASE_MS);
  expect(await balanceAfter(deps, t.clock)).toBe(879);
});

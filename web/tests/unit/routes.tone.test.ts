import { expect, test } from "vitest";
import * as toneRoute from "@/app/api/tone/route";
import { tonePayload } from "@/server/payload";
import { makeCreditsHandler } from "@/server/routes/credits";
import { makeToneHandler } from "@/server/routes/tone";
import { NOW, POLL_TONE, RUN_TONE } from "../helpers/constants";
import { jsonReply } from "../helpers/fakeFetch";
import { cookieFor, get, jsonPost, taskRouteWorstCase, testDeps } from "../helpers/routes";

const okTone = (skin: string) => ({ [RUN_TONE]: jsonReply(200, { data: { task_id: "t2" } }),
  [POLL_TONE]: jsonReply(200, { data: { task_status: "success", results: { color: { skin_color: skin } } } }) });
const toneReq = () => jsonPost("/api/tone", { fileId: "file-1" }, cookieFor(["file-1"]));

test.each([[119, 503, 0], [120, 200, 1]])("tone needs balance >= floor + 20 (balance %i)", async (balance, status, starts) => {
  const { deps, ff } = testDeps({ balance, routes: okTone("#C08A6B") });
  const res = await makeToneHandler(deps)(toneReq());
  expect(res.status).toBe(status); expect(ff.taskStarts()).toBe(starts);
});
test("tone sends the tone payload and returns skinColor from results.color.skin_color", async () => {
  const { deps, ff } = testDeps({ balance: 879, routes: okTone("#C08A6B") });
  const res = await makeToneHandler(deps)(toneReq());
  expect(JSON.parse(ff.calls.find((c) => c.url.endsWith("/task/skin-tone-analysis"))!.body as string)).toEqual(tonePayload("file-1"));
  expect(await res.json()).toEqual({ skinColor: "#C08A6B" });
});
test("tone answers 502 upstream for a malformed hex", async () => {
  const { deps } = testDeps({ balance: 879, routes: okTone("brown") });
  const res = await makeToneHandler(deps)(toneReq());
  expect(res.status).toBe(502); expect((await res.json()).error.code).toBe("upstream");
});
test("tone maps error_no_face to 422 no_face", async () => {                        // ai_skin_tone_analysis.yaml:540
  const { deps } = testDeps({ balance: 879, routes: { [RUN_TONE]: jsonReply(200, { data: { task_id: "t2" } }),
    [POLL_TONE]: jsonReply(200, { data: { task_status: "error", error: "error_no_face" } }) } });
  const res = await makeToneHandler(deps)(toneReq());
  expect(res.status).toBe(422); expect((await res.json()).error.code).toBe("no_face");
});

// Beyond the brief.
const balanceAfter = async (deps: ReturnType<typeof testDeps>["deps"], clock: { now: number }) => {
  clock.now = NOW;
  return (await (await makeCreditsHandler(deps)(get("/api/credits"))).json()).balance;
};
test("carry 1: tone holds 20 units; a success keeps them and a failure refunds them", async () => {
  const ok = testDeps({ balance: 879, routes: okTone("#C08A6B") });
  expect((await makeToneHandler(ok.deps)(toneReq())).status).toBe(200);
  expect(await balanceAfter(ok.deps, ok.clock)).toBe(859);
  const bad = testDeps({ balance: 879, routes: { [RUN_TONE]: jsonReply(200, { data: { task_id: "t2" } }),
    [POLL_TONE]: jsonReply(200, { data: { task_status: "error", error: "error_no_face" } }) } });
  expect((await makeToneHandler(bad.deps)(toneReq())).status).toBe(422);
  expect(await balanceAfter(bad.deps, bad.clock)).toBe(879);
});
test("tone refuses a fileId outside the session with 401 and no call", async () => {
  const { deps, ff } = testDeps({ balance: 879, routes: okTone("#C08A6B") });
  const res = await makeToneHandler(deps)(jsonPost("/api/tone", { fileId: "file-1" }, cookieFor(["file-2"])));
  expect(res.status).toBe(401); expect((await res.json()).error.code).toBe("session_missing"); expect(ff.calls).toEqual([]);
});
test("tone requires application/json and a string fileId", async () => {
  const { deps, ff } = testDeps({ balance: 879 });
  const text = new Request("https://cf.test/api/tone", { method: "POST", body: "{}", headers: { "Content-Type": "text/plain", cookie: cookieFor(["file-1"]) } });
  expect((await makeToneHandler(deps)(text)).status).toBe(400);
  expect((await makeToneHandler(deps)(jsonPost("/api/tone", { fileId: ["file-1"] }, cookieFor(["file-1"])))).status).toBe(400);
  expect(ff.calls).toEqual([]);
});
test("tone answers 502 when results carry no color object", async () => {
  const { deps } = testDeps({ balance: 879, routes: { [RUN_TONE]: jsonReply(200, { data: { task_id: "t2" } }),
    [POLL_TONE]: jsonReply(200, { data: { task_status: "success", results: { skin_color: "#C08A6B" } } }) } });
  expect((await makeToneHandler(deps)(toneReq())).status).toBe(502);
});
test("tone runs out of tries after two per session (limiter rule)", async () => {
  const { deps, ff } = testDeps({ balance: 879, routes: okTone("#C08A6B") });
  const h = makeToneHandler(deps);
  const cookie = cookieFor(["file-1"]);                                                    // one session for all three
  const req = () => jsonPost("/api/tone", { fileId: "file-1" }, cookie);
  expect([(await h(req())).status, (await h(req())).status]).toEqual([200, 200]);
  const third = await h(req());
  expect(third.status).toBe(429); expect((await third.json()).error.code).toBe("rate_limited");
  expect(ff.taskStarts()).toBe(2);
});

test("carry 2: tone route config is nodejs and maxDuration 120, at least 10 s above the worst case", () => {
  const { worstMs } = taskRouteWorstCase();
  expect(toneRoute.runtime).toBe("nodejs");
  expect(toneRoute.maxDuration).toBe(120);
  expect(toneRoute.maxDuration * 1000).toBeGreaterThanOrEqual(worstMs + 10_000);
  expect(typeof toneRoute.POST).toBe("function");
});

import { expect, test, vi } from "vitest";
import * as skinTypeRoute from "@/app/api/skin-type/route";
import { skinTypePayload } from "@/server/payload";
import { makeCreditsHandler } from "@/server/routes/credits";
import { makeSkinTypeHandler } from "@/server/routes/skinType";
import { NOW, POLL_SKIN_TYPE, RUN_SKIN_TYPE } from "../helpers/constants";
import { jsonReply } from "../helpers/fakeFetch";
import { cookieFor, get, jsonPost, taskRouteWorstCase, testDeps } from "../helpers/routes";

const started = { [RUN_SKIN_TYPE]: jsonReply(200, { data: { task_id: "t3" } }) };
const okSkinType = (scale: unknown) => ({ ...started,
  [POLL_SKIN_TYPE]: jsonReply(200, { data: { task_status: "success", results: { fitzpatrick_scale: scale, timed: 0.4 } } }) });
const skinReq = () => jsonPost("/api/skin-type", { fileId: "file-1" }, cookieFor(["file-1"]));
const balanceAfter = async (deps: ReturnType<typeof testDeps>["deps"], clock: { now: number }) => {
  clock.now = NOW;
  return (await (await makeCreditsHandler(deps)(get("/api/credits"))).json()).balance;
};

test("skin type sends the documented body and returns YouCam's Fitzpatrick type", async () => {
  const { deps, ff } = testDeps({ balance: 879, routes: okSkinType("IV") });
  const res = await makeSkinTypeHandler(deps)(skinReq());
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ fitzpatrick: "IV" });
  expect(JSON.parse(ff.calls.find((c) => c.url.endsWith("/task/fitzpatrick-scale-analyzer"))!.body as string)).toEqual(skinTypePayload("file-1"));
  expect(skinTypePayload("file-1")).toEqual({ src_file_id: "file-1", version: "1.0" });   // ai_fitzpatrick_skin_type.yaml:385-397
});
test.each([["iv"], ["VII"], [4], [null], [["IV"]]])("a type outside I to VI (%j) is 502 upstream", async (scale) => {
  const { deps } = testDeps({ balance: 879, routes: okSkinType(scale) });
  const res = await makeSkinTypeHandler(deps)(skinReq());
  expect(res.status).toBe(502); expect((await res.json()).error.code).toBe("upstream");
});
test.each([["error_no_face", 422, "no_face"], ["error_insufficient_lighting", 422, "lighting"], ["error_face_angle_invalid", 422, "face_angle"]])(
  "a task error %s answers %i %s", async (vendor, status, code) => {                        // ai_fitzpatrick_skin_type.yaml:196-212, :597
    const { deps } = testDeps({ balance: 879, routes: { ...started,
      [POLL_SKIN_TYPE]: jsonReply(200, { data: { task_status: "error", error: vendor } }) } });
    const res = await makeSkinTypeHandler(deps)(skinReq());
    expect(res.status).toBe(status); expect((await res.json()).error.code).toBe(code);
  });
test.each([[109, 503, 0], [110, 200, 1]])("skin type needs balance >= floor + 10 (balance %i)", async (balance, status, starts) => {
  const { deps, ff } = testDeps({ balance, routes: okSkinType("II") });
  const res = await makeSkinTypeHandler(deps)(skinReq());
  expect(res.status).toBe(status); expect(ff.taskStarts()).toBe(starts);
});
test("skin type holds 10 units, kept once YouCam accepts the task, refunded on a 4xx start", async () => {
  const ok = testDeps({ balance: 879, routes: okSkinType("III") });
  expect((await makeSkinTypeHandler(ok.deps)(skinReq())).status).toBe(200);
  expect(await balanceAfter(ok.deps, ok.clock)).toBe(869);
  const failed = testDeps({ balance: 879, routes: { ...started, [POLL_SKIN_TYPE]: jsonReply(200, { data: { task_status: "error", error: "error_no_face" } }) } });
  expect((await makeSkinTypeHandler(failed.deps)(skinReq())).status).toBe(422);
  expect(await balanceAfter(failed.deps, failed.clock)).toBe(869);
  const refused = testDeps({ balance: 879, routes: { [RUN_SKIN_TYPE]: jsonReply(402, { error_code: "CreditInsufficiency" }) } });
  expect((await makeSkinTypeHandler(refused.deps)(skinReq())).status).toBe(503);
  expect(await balanceAfter(refused.deps, refused.clock)).toBe(879);
});
test("skin type refuses a fileId outside the session with 401 and no call", async () => {
  const { deps, ff } = testDeps({ balance: 879, routes: okSkinType("IV") });
  const res = await makeSkinTypeHandler(deps)(jsonPost("/api/skin-type", { fileId: "file-1" }, cookieFor(["file-2"])));
  expect(res.status).toBe(401); expect((await res.json()).error.code).toBe("session_missing"); expect(ff.calls).toEqual([]);
});
test("skin type requires application/json and a string fileId, before any call", async () => {
  const { deps, ff } = testDeps({ balance: 879, routes: okSkinType("IV") });
  const text = new Request("https://cf.test/api/skin-type", { method: "POST", body: JSON.stringify({ fileId: "file-1" }),
    headers: { "Content-Type": "text/plain", cookie: cookieFor(["file-1"]) } });
  expect((await makeSkinTypeHandler(deps)(text)).status).toBe(400);
  expect((await makeSkinTypeHandler(deps)(jsonPost("/api/skin-type", { fileId: ["file-1"] }, cookieFor(["file-1"])))).status).toBe(400);
  expect(ff.calls).toEqual([]);
});
test("skin type without a key or secret is 503 not_configured and makes no call", async () => {
  const { deps, ff } = testDeps({ env: { youcamKey: null }, balance: 879, routes: okSkinType("IV") });
  const res = await makeSkinTypeHandler(deps)(skinReq());
  expect(res.status).toBe(503); expect((await res.json()).error.code).toBe("not_configured"); expect(ff.calls).toEqual([]);
});
test("skin type runs out of tries after three per session (limiter rule)", async () => {
  const { deps, ff } = testDeps({ balance: 879, routes: okSkinType("IV") });
  const h = makeSkinTypeHandler(deps);
  const take = vi.spyOn(deps().limiter, "take");
  const cookie = cookieFor(["file-1"]);
  const req = () => jsonPost("/api/skin-type", { fileId: "file-1" }, cookie);
  for (let i = 0; i < 3; i++) expect((await h(req())).status).toBe(200);
  const fourth = await h(req());
  expect(fourth.status).toBe(429); expect((await fourth.json()).error.code).toBe("rate_limited");
  expect(ff.taskStarts()).toBe(3);
  expect(take.mock.calls.every((c) => c[0] === "skinType")).toBe(true);
});
test("skin type route config is nodejs and maxDuration 120, at least 10 s above the worst case", () => {
  const { worstMs } = taskRouteWorstCase();
  expect(skinTypeRoute.runtime).toBe("nodejs");
  expect(skinTypeRoute.maxDuration).toBe(120);
  expect(skinTypeRoute.maxDuration * 1000).toBeGreaterThanOrEqual(worstMs + 10_000);
  expect(typeof skinTypeRoute.POST).toBe("function");
});

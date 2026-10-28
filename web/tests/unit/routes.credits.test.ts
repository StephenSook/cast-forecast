import { expect, test } from "vitest";
import * as creditsRoute from "@/app/api/credits/route";
import { makeCreditsHandler } from "@/server/routes/credits";
import { makeRenderHandler } from "@/server/routes/render";
import { CREDIT, POLL_VTO, RUN_VTO } from "../helpers/constants";
import { testEntry } from "../helpers/entries";
import { jsonReply } from "../helpers/fakeFetch";
import { cookieFor, get, jsonPost, testDeps } from "../helpers/routes";

const okRender = { [RUN_VTO]: jsonReply(200, { data: { task_id: "t1" } }),
  [POLL_VTO]: jsonReply(200, { data: { task_status: "success", results: { url: "https://out.example/r.png" } } }) };
const renderReq = (cookie = cookieFor(["file-1"])) => jsonPost("/api/render", { fileId: "file-1", bottleId: "test-a" }, cookie);

test("credits returns balance, floor and aboveFloor", async () => {
  const { deps } = testDeps({ balance: 879 });
  expect(await (await makeCreditsHandler(deps)(get("/api/credits"))).json()).toEqual({ balance: 879, floor: 100, aboveFloor: true });
});
test("a second call within 30 s reuses the cached balance", async () => {
  const { deps, ff } = testDeps({ balance: 879 });
  await makeCreditsHandler(deps)(get("/api/credits")); await makeCreditsHandler(deps)(get("/api/credits"));
  expect(ff.calls.filter((c) => c.url.endsWith("/client/credit"))).toHaveLength(1);
});
test("render spends one unit from the cached balance", async () => {
  const { deps, ff } = testDeps({ catalogue: [testEntry()], balance: 879, routes: okRender });
  expect((await makeRenderHandler(deps)(renderReq())).status).toBe(200);
  expect(await (await makeCreditsHandler(deps)(get("/api/credits"))).json()).toMatchObject({ balance: 878 });
  expect(ff.calls.filter((c) => c.url.endsWith("/client/credit"))).toHaveLength(1);
});

// Beyond the brief.
test("aboveFloor is false when one render would cross the floor, and the floor follows env", async () => {
  expect(await (await makeCreditsHandler(testDeps({ balance: 100 }).deps)(get("/api/credits"))).json())
    .toEqual({ balance: 100, floor: 100, aboveFloor: false });
  expect(await (await makeCreditsHandler(testDeps({ balance: 100, env: { creditFloor: 50 } }).deps)(get("/api/credits"))).json())
    .toEqual({ balance: 100, floor: 50, aboveFloor: true });
});
test("credits is limited per IP: the 31st call in an hour is 429 rate_limited", async () => {
  const { deps } = testDeps({ balance: 879 });
  const h = makeCreditsHandler(deps);
  for (let i = 0; i < 30; i++) expect((await h(get("/api/credits"))).status).toBe(200);
  const res = await h(get("/api/credits"));
  expect(res.status).toBe(429); expect((await res.json()).error.code).toBe("rate_limited"); expect(res.headers.get("retry-after")).toBe("3600");
});
test("a failed balance read maps through mapYouCamError", async () => {
  const { deps } = testDeps({ routes: { [CREDIT]: jsonReply(401, { error_code: "InvalidApiKey" }) } });
  const res = await makeCreditsHandler(deps)(get("/api/credits"));
  expect(res.status).toBe(503); expect((await res.json()).error.code).toBe("not_configured");
});
test("credits does not need the session secret and is not cached", async () => {
  const res = await makeCreditsHandler(testDeps({ balance: 879, env: { sessionSecret: null } }).deps)(get("/api/credits"));
  expect(res.status).toBe(200); expect(res.headers.get("cache-control")).toBe("no-store");
});
test("credits route config: nodejs, force-dynamic", () => {
  expect(creditsRoute.runtime).toBe("nodejs");
  expect(creditsRoute.dynamic).toBe("force-dynamic");
  expect(typeof creditsRoute.GET).toBe("function");
});

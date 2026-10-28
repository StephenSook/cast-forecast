import { expect, test, vi } from "vitest";
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
// Codex r1 finding A: this replaces "a success keeps them and a failure refunds them", which refunded the 20 units of a
// task YouCam had already accepted (an error_no_face poll result).
test("carry 1: tone holds 20 units; they stay spent once YouCam accepts the task, whatever the poll says", async () => {
  const accepted = { [RUN_TONE]: jsonReply(200, { data: { task_id: "t2" } }) };
  const ok = testDeps({ balance: 879, routes: okTone("#C08A6B") });
  expect((await makeToneHandler(ok.deps)(toneReq())).status).toBe(200);
  expect(await balanceAfter(ok.deps, ok.clock)).toBe(859);
  const cases: [Record<string, Response | Error>, number][] = [
    [{ ...accepted, [POLL_TONE]: jsonReply(200, { data: { task_status: "error", error: "error_no_face" } }) }, 422],
    [{ ...accepted, [POLL_TONE]: jsonReply(200, { data: { task_status: "success", results: {} } }) }, 502],
    [{ ...accepted, [POLL_TONE]: jsonReply(200, { data: { task_status: "running" } }) }, 504],
    [{ ...accepted, [POLL_TONE]: new TypeError("fetch failed") }, 502],
  ];
  for (const [routes, status] of cases) {
    const t = testDeps({ balance: 879, routes });
    expect((await makeToneHandler(t.deps)(toneReq())).status).toBe(status);
    expect(await balanceAfter(t.deps, t.clock)).toBe(859);
  }
});
test("carry 1: tone refunds its 20 units when the task start fails", async () => {
  for (const start of [new Response("", { status: 429 }), new TypeError("fetch failed"), jsonReply(200, { data: {} })]) {
    const t = testDeps({ balance: 879, routes: { [RUN_TONE]: start } });
    expect((await makeToneHandler(t.deps)(toneReq())).status).not.toBe(200);
    expect(await balanceAfter(t.deps, t.clock)).toBe(879);
    expect(t.ff.taskStarts()).toBe(1);
  }
});
test("tone refuses a fileId outside the session with 401 and no call", async () => {
  const { deps, ff } = testDeps({ balance: 879, routes: okTone("#C08A6B") });
  const res = await makeToneHandler(deps)(jsonPost("/api/tone", { fileId: "file-1" }, cookieFor(["file-2"])));
  expect(res.status).toBe(401); expect((await res.json()).error.code).toBe("session_missing"); expect(ff.calls).toEqual([]);
});
test("tone requires application/json and a string fileId", async () => {
  // Fix round 1: a VALID body over scripted ok routes, so only the content-type guard can refuse it.
  const { deps, ff } = testDeps({ balance: 879, routes: okTone("#C08A6B") });
  const text = new Request("https://cf.test/api/tone", { method: "POST", body: JSON.stringify({ fileId: "file-1" }),
    headers: { "Content-Type": "text/plain", cookie: cookieFor(["file-1"]) } });
  const refused = await makeToneHandler(deps)(text);
  expect(refused.status).toBe(400); expect((await refused.json()).error.code).toBe("bad_request"); expect(ff.calls).toEqual([]);
  expect((await makeToneHandler(deps)(jsonPost("/api/tone", { fileId: ["file-1"] }, cookieFor(["file-1"])))).status).toBe(400);
  expect(ff.calls).toEqual([]);
});
// Fix round 1 item 5: on Vercel the limiter key is the client's address, so two addresses get separate buckets.
test("on Vercel, tone limits each x-real-ip on its own: the same address is refused, another is not", async () => {
  vi.stubEnv("VERCEL", "1");
  try {
    const { deps } = testDeps({ balance: 879, routes: okTone("#C08A6B") });
    const h = makeToneHandler(deps);
    const from = (ip: string) => {
      const req = jsonPost("/api/tone", { fileId: "file-1" }, cookieFor(["file-1"]));                      // a new session each time
      req.headers.set("x-real-ip", ip);
      return h(req);
    };
    for (let i = 0; i < 6; i++) expect((await from("198.51.100.7")).status).toBe(200);                    // perIp 6
    const refused = await from("198.51.100.7");
    expect(refused.status).toBe(429); expect((await refused.json()).error.code).toBe("rate_limited");
    expect((await from("198.51.100.8")).status).toBe(200);
  } finally {
    vi.unstubAllEnvs();
  }
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

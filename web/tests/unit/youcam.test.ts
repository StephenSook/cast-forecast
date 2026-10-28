import { expect, test, vi } from "vitest";
import { YOUCAM_BASE, YouCamError, createYouCam, sumCredits } from "@/server/youcam";
import { CREDIT, KEY, POLL_TONE, POLL_VTO, PUT, REGISTER, RUN_TONE, RUN_VTO, registerReply } from "../helpers/constants";
import { fakeFetch, jsonReply } from "../helpers/fakeFetch";

const yc = (ff: ReturnType<typeof fakeFetch>, o: Partial<Parameters<typeof createYouCam>[0]> = {}) => createYouCam({ key: KEY, fetch: ff.fetch, ...o });
test("upload registers with Bearer JSON, then PUTs the exact bytes with only the presigned headers", async () => {
  const ff = fakeFetch({ [REGISTER]: registerReply("file-1"), [PUT]: new Response(null, { status: 200 }) });
  expect(await yc(ff).upload(new Uint8Array([1, 2, 3]), "selfie.jpg")).toBe("file-1");
  expect(ff.calls[0]).toMatchObject({ method: "POST", url: `${YOUCAM_BASE}/s2s/v2.0/file`,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" } });
  expect(JSON.parse(ff.calls[0].body as string)).toEqual({ files: [{ content_type: "image/jpeg", file_name: "selfie.jpg", file_size: 3 }] });
  expect(ff.calls[1]).toMatchObject({ method: "PUT", url: "https://s3.example/put" });
  expect(ff.calls[1].headers).toEqual({ "Content-Type": "image/jpeg", "x-amz-test": "1" });     // no Authorization
  expect(ff.calls[1].body).toEqual(new Uint8Array([1, 2, 3]));
});
test("a failed PUT raises http_403", async () => {
  const ff = fakeFetch({ [REGISTER]: registerReply("file-1"), [PUT]: new Response("", { status: 403 }) });
  await expect(yc(ff).upload(new Uint8Array([1]), "a.jpg")).rejects.toMatchObject({ code: "http_403", status: 403 });
});
test("every call carries an AbortSignal", async () => {
  const ff = fakeFetch({ [REGISTER]: registerReply("file-1"), [PUT]: new Response(null, { status: 200 }),
    [RUN_VTO]: jsonReply(200, { data: { task_id: "t1" } }),
    [POLL_VTO]: jsonReply(200, { data: { task_status: "success", results: { url: "https://out.example/r.png" } } }) });
  const c = yc(ff);
  await c.upload(new Uint8Array([1]), "a.jpg"); await c.run("task/makeup-vto", {}); await c.poll("task/makeup-vto", "t1");
  expect(ff.calls).toHaveLength(4);
  expect(ff.calls.every((x) => x.signal instanceof AbortSignal)).toBe(true);
});
test("an aborted call raises timeout", async () =>
  await expect(yc(fakeFetch({ [CREDIT]: new DOMException("timed out", "TimeoutError") })).balance()).rejects.toMatchObject({ code: "timeout" }));
test.each([[{ results: { total_credits: 879 } }, 879], [{ data: [{ amount: 500 }, { amount: 379 }] }, 879]])("balance shape %j", async (body, want) =>
  expect(await yc(fakeFetch({ [CREDIT]: jsonReply(200, body) })).balance()).toBe(want));
test.each([{ results: true }, { data: { balance: "12" } }])("balance rejects %j as bad_shape", async (body) =>
  await expect(yc(fakeFetch({ [CREDIT]: jsonReply(200, body) })).balance()).rejects.toMatchObject({ code: "bad_shape" }));
test("poll waits 2000 ms while running, then returns results", async () => {
  const sleep = vi.fn(async () => {});
  const ff = fakeFetch({ [POLL_VTO]: [jsonReply(200, { data: { task_status: "running" } }),
    jsonReply(200, { data: { task_status: "success", results: { url: "https://out.example/r.png" } } })] });
  expect(await yc(ff, { sleep }).poll("task/makeup-vto", "t1")).toEqual({ url: "https://out.example/r.png" });
  expect(sleep.mock.calls).toEqual([[2000]]);
});
test.each([["error", "error_face_position_invalid"], ["error_code", "error_face_angle_invalid"]])(
  "poll raises the task %s field with the task id", async (field, code) => {
    const ff = fakeFetch({ [POLL_VTO]: jsonReply(200, { data: { task_status: "error", [field]: code } }) });
    await expect(yc(ff).poll("task/makeup-vto", "t1")).rejects.toMatchObject({ code, taskId: "t1" });
  });
test("poll raises timeout at the deadline", async () => {
  let t = 0;
  const ff = fakeFetch({ [POLL_VTO]: jsonReply(200, { data: { task_status: "running" } }) });
  const c = yc(ff, { now: () => t, sleep: async (ms) => { t += ms; } });
  await expect(c.poll("task/makeup-vto", "t1", 5000)).rejects.toMatchObject({ code: "timeout", taskId: "t1" });
  expect(ff.calls).toHaveLength(4);                       // GETs at t = 0, 2000, 4000, 6000 (youcam.py:207-231 order)
});
test.each([[{ task_status: "success", results: {} }], [{ task_status: "success" }]])("poll raises bad_shape for %j", async (data) =>
  await expect(yc(fakeFetch({ [POLL_VTO]: jsonReply(200, { data }) })).poll("task/makeup-vto", "t1")).rejects.toMatchObject({ code: "bad_shape" }));
test("HTTP 400 surfaces error_code CreditInsufficiency with the status", async () => {
  const ff = fakeFetch({ [RUN_VTO]: jsonReply(400, { status: 400, error: "x", error_code: "CreditInsufficiency" }) });
  await expect(yc(ff).run("task/makeup-vto", {})).rejects.toMatchObject({ code: "CreditInsufficiency", status: 400 });
});
test("HTTP 429 raises http_429 without sleeping or retrying", async () => {          // differs from youcam.py on purpose
  const sleep = vi.fn(async () => {});
  const ff = fakeFetch({ [RUN_VTO]: new Response("", { status: 429 }) });
  await expect(yc(ff, { sleep }).run("task/makeup-vto", {})).rejects.toMatchObject({ code: "http_429", status: 429 });
  expect(sleep).not.toHaveBeenCalled(); expect(ff.calls).toHaveLength(1);
});
test("a thrown fetch raises network", async () =>
  await expect(yc(fakeFetch({ [CREDIT]: new TypeError("fetch failed") })).balance()).rejects.toMatchObject({ code: "network" }));
test("a non-JSON 200 raises bad_json", async () =>
  await expect(yc(fakeFetch({ [CREDIT]: new Response("<html>", { status: 200 }) })).balance()).rejects.toMatchObject({ code: "bad_json" }));
test("run returns data.task_id and raises bad_shape without it", async () => {
  expect(await yc(fakeFetch({ [RUN_VTO]: jsonReply(200, { data: { task_id: "t1" } }) })).run("task/makeup-vto", {})).toBe("t1");
  await expect(yc(fakeFetch({ [RUN_VTO]: jsonReply(200, { data: {} }) })).run("task/makeup-vto", {})).rejects.toMatchObject({ code: "bad_shape" });
});

// Beyond the brief: key handling, wire details and shape checks.
test("JSON calls send only the Bearer key; the tone task posts its payload", async () => {
  const ff = fakeFetch({ [CREDIT]: jsonReply(200, { results: { total_credits: 5 } }),
    [RUN_TONE]: jsonReply(200, { data: { task_id: "t2" } }),
    [POLL_TONE]: jsonReply(200, { data: { task_status: "success", results: { skin_color: "#C08A6B" } } }) });
  const c = yc(ff);
  await c.balance();
  expect(await c.run("task/skin-tone-analysis", { src_file_id: "f1" })).toBe("t2");
  expect(await c.poll("task/skin-tone-analysis", "t2")).toEqual({ skin_color: "#C08A6B" });
  expect(ff.calls.map((x) => x.headers)).toEqual([{ Authorization: `Bearer ${KEY}` },
    { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, { Authorization: `Bearer ${KEY}` }]);
  expect(JSON.parse(ff.calls[1].body as string)).toEqual({ src_file_id: "f1" });
});
test("every call refuses redirects and uses the right timeout", async () => {
  const seen: RequestInit[] = [];
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const spy = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init ?? {});
    return String(_url).startsWith("https://s3.example") ? new Response(null, { status: 200 }) : registerReply("file-1");
  }) as typeof fetch;
  try {
    await createYouCam({ key: KEY, fetch: spy }).upload(new Uint8Array([1]), "a.jpg");
    expect(seen.map((i) => i.redirect)).toEqual(["manual", "manual"]);
    expect(timeout.mock.calls).toEqual([[15_000], [30_000]]);
  } finally {
    timeout.mockRestore();
  }
});
test.each(["", "key\n", "key\u0000x", "k\u00e9y"])("refuses key %j without echoing it", (key) => {
  let err: unknown;
  try { createYouCam({ key, fetch: fakeFetch({}).fetch }); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(YouCamError);
  if (key) expect(String((err as Error).message)).not.toContain(key);
});
test("errors never carry the key", async () => {
  const errors: unknown[] = [];
  const cases: [string, Response | Error][] = [[CREDIT, new TypeError(`fetch failed for Bearer ${KEY}`)],
    [CREDIT, jsonReply(401, { error_code: "InvalidApiKey" })], [CREDIT, new Response("<html>", { status: 200 })]];
  for (const [route, reply] of cases) await yc(fakeFetch({ [route]: reply })).balance().catch((e) => errors.push(e));
  expect(errors).toHaveLength(3);
  for (const e of errors) {
    expect(e).toBeInstanceOf(YouCamError);
    expect(JSON.stringify({ ...(e as object), message: (e as Error).message, stack: (e as Error).stack })).not.toContain(KEY);
    expect((e as Error).cause).toBeUndefined();
  }
});
test("a non-2xx without error_code is http_<status>; a malformed error_code is not trusted", async () => {
  await expect(yc(fakeFetch({ [RUN_VTO]: jsonReply(500, { status: 500 }) })).run("task/makeup-vto", {}))
    .rejects.toMatchObject({ code: "http_500", status: 500 });
  await expect(yc(fakeFetch({ [RUN_VTO]: jsonReply(400, { error_code: "bad code\nwith newline" }) })).run("task/makeup-vto", {}))
    .rejects.toMatchObject({ code: "http_400", status: 400 });
  await expect(yc(fakeFetch({ [RUN_VTO]: new Response(null, { status: 302 }) })).run("task/makeup-vto", {}))
    .rejects.toMatchObject({ code: "http_302", status: 302 });
});
test("upload refuses a bad registration before any PUT", async () => {
  const bad = [{ data: { files: [] } }, { data: { files: [{ file_id: "f", requests: [] }] } },
    { data: { files: [{ file_id: "f", requests: [{ url: "http://s3.example/put", method: "PUT", headers: {} }] }] } },
    { data: { files: [{ file_id: "f", requests: [{ url: "https://s3.example/put", method: "PUT", headers: { a: { b: 1 } } }] }] } },
    { data: { files: [{ file_id: "", requests: [{ url: "https://s3.example/put", method: "PUT", headers: {} }] }] } }];
  for (const body of bad) {
    const ff = fakeFetch({ [REGISTER]: jsonReply(200, body) });
    await expect(yc(ff).upload(new Uint8Array([1]), "a.jpg"), JSON.stringify(body)).rejects.toMatchObject({ code: "bad_shape" });
    expect(ff.calls).toHaveLength(1);
  }
});
test("poll and run refuse task ids that could change the path", async () => {
  const ff = fakeFetch({});
  for (const id of ["", "../client/credit", "a.b", "a?b", "a b"])
    await expect(yc(ff).poll("task/makeup-vto", id), id).rejects.toMatchObject({ code: "bad_task_id" });
  expect(ff.calls).toHaveLength(0);
  await expect(yc(fakeFetch({ [RUN_VTO]: jsonReply(200, { data: { task_id: "../x" } }) })).run("task/makeup-vto", {}))
    .rejects.toMatchObject({ code: "bad_shape" });
});
test("poll takes the first code-shaped field from error, then error_code", async () => {
  const ff = fakeFetch({ [POLL_VTO]: jsonReply(200, { data: { task_status: "error", error: "The face angle is wrong.",
    error_code: "error_face_angle_invalid" } }) });
  await expect(yc(ff).poll("task/makeup-vto", "t1")).rejects.toMatchObject({ code: "error_face_angle_invalid", taskId: "t1" });
  const none = fakeFetch({ [POLL_VTO]: jsonReply(200, { data: { task_status: "error" } }) });
  await expect(yc(none).poll("task/makeup-vto", "t1")).rejects.toMatchObject({ code: "error", taskId: "t1" });
});
test("balance reads results when the key is present, even when it is null (youcam.py:160)", async () =>
  await expect(yc(fakeFetch({ [CREDIT]: jsonReply(200, { results: null, data: { amount: 5 } }) })).balance())
    .rejects.toMatchObject({ code: "bad_shape" }));
test("sumCredits ports _sum_credits", () => {
  expect(sumCredits(7)).toBe(7);
  expect(sumCredits(1.5)).toBeNull();
  expect(sumCredits(true)).toBeNull();
  expect(sumCredits("12")).toBeNull();
  expect(sumCredits(null)).toBeNull();
  expect(sumCredits({ total_credits: 5, amount: 9 })).toBe(5);              // key order
  expect(sumCredits({ credit: null, balance: 3 })).toBeNull();              // the first present key decides
  expect(sumCredits({ other: 3 })).toBeNull();
  expect(sumCredits([])).toBeNull();
  expect(sumCredits([true, 2, { balance: [1, 1] }])).toBe(4);
});

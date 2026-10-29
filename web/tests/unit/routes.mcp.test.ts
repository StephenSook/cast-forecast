import { expect, test, vi } from "vitest";
import * as mcpRoute from "@/app/api/mcp/route";
import { CATALOGUE, RETAIL_ERROR_L, type Whitening, labelUrl } from "@/lib/catalogue";
import { LIGHTNESS_RANGE, ZINC_RANGE } from "@/lib/labelModel";
import { RULES } from "@/server/limits";
import { labelModelPayload } from "@/server/routes/labelModel";
import {
  LEGACY_VERSIONS,
  LIST_TTL_MS,
  MAX_BODY_BYTES,
  MODERN_VERSIONS,
  ORIGIN_REFUSED,
  POST_ONLY,
  RATE_LIMITED,
  SERVER_INFO,
  SUPPORTED_VERSIONS,
  acceptsJson,
  decodeHeaderValue,
  makeMcpHandler,
} from "@/server/routes/mcp";
import { findCopyViolations } from "../helpers/copyGuard";
import { testDeps } from "../helpers/routes";

const ENDPOINT = "https://cf.test/api/mcp";
const MODERN = MODERN_VERSIONS[0];
const META = { "io.modelcontextprotocol/protocolVersion": MODERN, "io.modelcontextprotocol/clientCapabilities": {} };

type Headers = Record<string, string>;
type Schema = { type: string; additionalProperties: boolean; required?: string[]; properties: Record<string, { minimum?: number; maximum?: number }> };
/** The fields these tests read from any result; each test reads only the ones its method answers. */
type Result = {
  tools: { name: string; description: string; inputSchema: Schema; annotations: object }[];
  structuredContent: { bottles: { labelUrl: string }[]; whitening: Whitening; bottle: unknown } & Record<string, unknown>;
  content: { type: string; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
};
type Body = { jsonrpc: string; id?: string | number; result?: Result; error?: { code: number; message: string; data?: unknown } };

/** A handler over the shipped catalogue, a fresh limiter and a fake clock. `send` POSTs one body (a string as is). */
function server() {
  const { deps } = testDeps({ catalogue: CATALOGUE });
  const handler = makeMcpHandler(deps);
  return (body: unknown, headers: Headers = {}) =>
    handler(new Request(ENDPOINT, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } }));
}
const rpc = (method: string, params?: object, id: string | number = 1) => (params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params });
const call = (name: string, args?: unknown) => rpc("tools/call", args === undefined ? { name } : { name, arguments: args });
const modernHeaders = (method: string, name?: string): Headers => ({
  "MCP-Protocol-Version": MODERN,
  "Mcp-Method": method,
  ...(name === undefined ? {} : { "Mcp-Name": name }),
});

async function answer(res: Response): Promise<Body> {
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  expect(res.headers.get("cache-control")).toBe("no-store");
  return (await res.json()) as Body;
}
/** The tool result of a 200 tools/call, or the failure that came instead. */
async function tool(res: Response) {
  expect(res.status).toBe(200);
  const b = await answer(res);
  expect(b.error, JSON.stringify(b.error)).toBeUndefined();
  return b.result!;
}
async function rpcErrorOf(res: Response, status: number, code: number) {
  expect(res.status).toBe(status);
  const b = await answer(res);
  expect(b.result).toBeUndefined();
  expect(b.error!.code).toBe(code);
  return b;
}

// Lifecycle (2025-11-25 and earlier).
test("initialize answers the version asked for when the handshake serves it, else the newest it serves", async () => {
  const send = server();
  for (const v of LEGACY_VERSIONS) {
    const r = (await answer(await send(rpc("initialize", { protocolVersion: v, capabilities: {}, clientInfo: { name: "t", version: "1" } })))).result!;
    expect(r.protocolVersion).toBe(v);
  }
  for (const v of ["1999-01-01", MODERN]) {
    const b = await answer(await send(rpc("initialize", { protocolVersion: v, capabilities: {} }, "a")));
    expect(b.id).toBe("a");
    expect(b.result).toEqual({
      protocolVersion: LEGACY_VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: expect.stringContaining("list_bottles"),
    });
  }
  expect(SERVER_INFO.name).toBe("cast-forecast");
  await rpcErrorOf(await send(rpc("initialize", {})), 200, -32602);
});

test("notifications are accepted with 202 and no body", async () => {
  const send = server();
  for (const n of [{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } }]) {
    const res = await send(n);
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  }
});

test("ping answers an empty result, and no session id is ever minted or echoed", async () => {
  const res = await server()(rpc("ping", undefined, 7), { "Mcp-Session-Id": "abc" });
  expect(res.headers.get("mcp-session-id")).toBeNull();
  expect(await answer(res)).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
});

test("tools/list names the three tools, each with an object input schema that takes nothing else", async () => {
  const r = await tool(await server()(rpc("tools/list")));
  expect(r.tools.map((t: { name: string }) => t.name)).toEqual(["list_bottles", "predict_cast", "held_out_error"]);
  for (const t of r.tools) {
    expect(t.inputSchema.type).toBe("object");
    expect(t.inputSchema.additionalProperties).toBe(false);
    expect(t.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(t.description.length).toBeGreaterThan(20);
  }
  const predict = r.tools[1].inputSchema;
  expect(predict.required).toEqual(["skin_lightness"]);
  expect([predict.properties.zinc_oxide_pct.minimum, predict.properties.zinc_oxide_pct.maximum]).toEqual([...ZINC_RANGE]);
  expect([predict.properties.skin_lightness.minimum, predict.properties.skin_lightness.maximum]).toEqual([...LIGHTNESS_RANGE]);
  expect(r).not.toHaveProperty("resultType"); // legacy envelope
});

// The tools.
test("list_bottles returns the shipped catalogue's ids, names and label evidence as the catalogue has them", async () => {
  const r = await tool(await server()(call("list_bottles")));
  expect(r.isError).toBeUndefined();
  expect(r.structuredContent.bottles).toEqual(
    CATALOGUE.map((b) => ({ id: b.id, name: b.name, brand: b.brand, evidence: b.evidence, labelUrl: labelUrl(b) })),
  );
  expect(r.structuredContent.bottles.length).toBeGreaterThanOrEqual(5);
  expect(r.structuredContent.bottles[0].labelUrl).toBe(`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${CATALOGUE[0].evidence.setId}`);
  expect(JSON.parse(r.content[1].text)).toEqual(r.structuredContent);
});

test("predict_cast answers exactly the catalogue's published whitening, for every bottle on every tone", async () => {
  const send = server();
  let checked = 0;
  for (const b of CATALOGUE) {
    for (const t of b.tones) {
      const r = await tool(await send(call("predict_cast", { bottle_id: b.id, skin_lightness: t.lStar })));
      expect(r.isError).toBeUndefined();
      expect(r.structuredContent.whitening, `${b.id} L* ${t.lStar}`).toEqual(t.whitening);
      expect(r.structuredContent).toMatchObject({ bottle: { id: b.id, name: b.name, brand: b.brand }, zincOxidePct: b.evidence.zincOxidePct, skinLightness: t.lStar });
      checked++;
    }
    // The middle tone's prediction is the one number per bottle the site shows (bottle.whitening).
    const mid = await tool(await send(call("predict_cast", { bottle_id: b.id, skin_lightness: 55 })));
    expect(mid.structuredContent.whitening).toEqual(b.whitening);
  }
  expect(checked).toBeGreaterThanOrEqual(40);
});

test("predict_cast from a label percent equals the same bottle by id, and the band is the retail error", async () => {
  const send = server();
  for (const b of CATALOGUE.slice(0, 3)) {
    const byId = await tool(await send(call("predict_cast", { bottle_id: b.id, skin_lightness: 50 })));
    const byPct = await tool(await send(call("predict_cast", { zinc_oxide_pct: b.evidence.zincOxidePct, skin_lightness: 50 })));
    expect(byPct.structuredContent.whitening).toEqual(byId.structuredContent.whitening);
    expect(byPct.structuredContent.bottle).toBeNull();
    const w = byPct.structuredContent.whitening;
    expect(w.high - w.value).toBeCloseTo(RETAIL_ERROR_L, 5);
    expect(w.value - w.low).toBeCloseTo(RETAIL_ERROR_L, 5);
    expect(byPct.content[0].text).toMatch(new RegExp(`^${b.evidence.zincOxidePct}% zinc oxide on skin L\\* 50: predicted lightening [+-]\\d+\\.\\d L\\*, band `));
  }
});

test("predict_cast covers the study's ends and a null optional reads as not given", async () => {
  const send = server();
  for (const z of ZINC_RANGE) for (const l of LIGHTNESS_RANGE) {
    expect((await tool(await send(call("predict_cast", { zinc_oxide_pct: z, skin_lightness: l })))).isError).toBeUndefined();
  }
  const r = await tool(await send(call("predict_cast", { bottle_id: CATALOGUE[0].id, zinc_oxide_pct: null, skin_lightness: 55 })));
  expect(r.structuredContent.whitening).toEqual(CATALOGUE[0].whitening);
});

test("predict_cast refuses, as a tool error the model can read, everything it cannot answer", async () => {
  const send = server();
  const id = CATALOGUE[0].id;
  const [zLo, zHi] = ZINC_RANGE;
  const [lLo, lHi] = LIGHTNESS_RANGE;
  const outsideL = `outside the study's ${lLo.toFixed(1)} to ${lHi.toFixed(1)}`;
  const cases: [unknown, RegExp][] = [
    [{ zinc_oxide_pct: zLo - 0.1, skin_lightness: 55 }, new RegExp(`outside the study's ${zLo} to ${zHi}%`)],
    [{ zinc_oxide_pct: zHi + 0.1, skin_lightness: 55 }, /outside the study's/],
    [{ zinc_oxide_pct: 0, skin_lightness: 55 }, /outside the study's/],
    [{ bottle_id: id, skin_lightness: lLo - 0.1 }, new RegExp(outsideL.replace(/[.*]/g, "\\$&"))],
    [{ bottle_id: id, skin_lightness: lHi + 0.1 }, /outside the study's/],
    [{ bottle_id: id, skin_lightness: 40 }, /never extrapolated/],
    [{ bottle_id: id, zinc_oxide_pct: 12, skin_lightness: 55 }, /not both/],
    [{ skin_lightness: 55 }, /give bottle_id/],
    [{ bottle_id: null, zinc_oxide_pct: null, skin_lightness: 55 }, /give bottle_id/],
    [{ bottle_id: id }, /skin_lightness .* is required/],
    [{ bottle_id: id, skin_lightness: null }, /skin_lightness .* is required/],
    [{ bottle_id: id, skin_lightness: "55" }, /skin_lightness must be a finite number/],
    [{ bottle_id: id, skin_lightness: true }, /skin_lightness must be a finite number/],
    [{ bottle_id: id, skin_lightness: [55] }, /skin_lightness must be a finite number/],
    [{ zinc_oxide_pct: "12", skin_lightness: 55 }, /zinc_oxide_pct must be a finite number/],
    [{ zinc_oxide_pct: {}, skin_lightness: 55 }, /zinc_oxide_pct must be a finite number/],
    [{ bottle_id: 7, skin_lightness: 55 }, /bottle_id must be a string/],
    [{ bottle_id: "no-such-bottle", skin_lightness: 55 }, /^No prediction: no bottle has that bottle_id\. Call list_bottles/],
    [{ bottle_id: "x".repeat(200), skin_lightness: 55 }, /no bottle has that bottle_id/],
    [{ bottle_id: id, skin_lightness: 55, tone: "light" }, /predict_cast takes only bottle_id or zinc_oxide_pct, and skin_lightness/],
  ];
  for (const [args, why] of cases) {
    const r = await tool(await send(call("predict_cast", args)));
    expect(r.isError, JSON.stringify(args)).toBe(true);
    expect(r.structuredContent).toBeUndefined();
    expect(r.content).toHaveLength(1);
    expect(r.content[0].text, JSON.stringify(args)).toMatch(/^No prediction: /);
    expect(r.content[0].text, JSON.stringify(args)).toMatch(why);
  }
  // Raw bodies: JSON carries no NaN, but 1e400 parses to Infinity; a "__proto__" key parses to an own property.
  const raw: [string, RegExp][] = [
    [`{"zinc_oxide_pct":1e400,"skin_lightness":55}`, /zinc_oxide_pct must be a finite number/],
    [`{"bottle_id":"${id}","skin_lightness":-1e400}`, /skin_lightness must be a finite number/],
    [`{"bottle_id":"${id}","skin_lightness":55,"__proto__":{"x":1}}`, /predict_cast takes only/],
  ];
  for (const [args, why] of raw) {
    const r = await tool(await send(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"predict_cast","arguments":${args}}}`));
    expect(r.isError, args).toBe(true);
    expect(r.content[0].text, args).toMatch(why);
  }
});

test("held_out_error is the /api/label-model payload; the no-argument tools refuse arguments", async () => {
  const send = server();
  const r = await tool(await send(call("held_out_error", {})));
  const payload = labelModelPayload();
  expect(r.structuredContent).toEqual(JSON.parse(JSON.stringify(payload)));
  const h = payload.heldOut;
  expect(r.content[0].text).toBe(
    `Held-out error, L*: ${h.maeL.toFixed(2)} on ${h.cells} cells, ${h.darkerSkin.maeL.toFixed(2)} on darker skin (${h.darkerSkin.cells}), ` +
      `${h.benchmark.maeL.toFixed(2)} on the benchmark product (${h.benchmark.cells}).`,
  );
  for (const name of ["held_out_error", "list_bottles"]) {
    const bad = await tool(await send(call(name, { x: 1 })));
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toBe(`${name} takes no arguments.`);
  }
});

test("an unknown tool and a malformed tools/call are protocol errors (-32602)", async () => {
  const send = server();
  expect((await rpcErrorOf(await send(call("predict_tan", {})), 200, -32602)).error!.message).toBe("Unknown tool. The tools are list_bottles, predict_cast, held_out_error.");
  await rpcErrorOf(await send(rpc("tools/call", { arguments: {} })), 200, -32602);
  await rpcErrorOf(await send(rpc("tools/call", { name: 5 })), 200, -32602);
  for (const args of [[], "x", null, 3]) await rpcErrorOf(await send(call("predict_cast", args)), 200, -32602);
  await rpcErrorOf(await send(rpc("tools/list", { cursor: "next" })), 200, -32602);
  await rpcErrorOf(await send(rpc("ping", [1] as unknown as object)), 200, -32602);
});

// Codex review: a caller could make the server say whatever it sent, banned copy included. Every reply here is
// checked with the site's own copy guard, and none may repeat the planted text.
test("no reply repeats what the caller sent", async () => {
  const send = server();
  const planted = `${String.fromCharCode(0x2014)}SPF 50 protects${String.fromCharCode(0x201d)}`;
  const replies = [
    await send(call("predict_cast", { bottle_id: planted, skin_lightness: 55 })),
    await send(call("predict_cast", { bottle_id: CATALOGUE[0].id, skin_lightness: 55, [planted]: 1 })),
    await send(call("list_bottles", { [planted]: 1 })),
    await send(call(planted, {})),
    await send(rpc(planted)),
    await send(rpc("SPF", { _meta: META }), modernHeaders("SPF")), // a header value cannot carry the dash, so ASCII
    await send(rpc("tools/list"), { "MCP-Protocol-Version": "SPF" }), // data.requested is the spec's own echo
    await send(rpc("tools/list", { _meta: META }), { ...modernHeaders("tools/list"), "Mcp-Method": "SPF" }),
    await send(rpc("tools/call", { name: "predict_cast", arguments: {}, _meta: META }), modernHeaders("tools/call", "SPF")),
  ];
  expect(replies).toHaveLength(9);
  for (const res of replies) {
    const b = await answer(res);
    const text = b.error ? b.error.message : b.result!.content.map((c) => c.text).join(" ");
    expect(text.length).toBeGreaterThan(5);
    expect(text, text).not.toContain("SPF");
    expect(findCopyViolations(text, "reply"), text).toEqual([]);
  }
});

// JSON-RPC framing.
test("malformed JSON and invalid UTF-8 are parse errors (-32700) with no id", async () => {
  const send = server();
  for (const body of ["{", "", "not json", '{"jsonrpc":"2.0",}']) {
    const b = await rpcErrorOf(await send(body), 400, -32700);
    expect(b).not.toHaveProperty("id");
  }
  const { deps } = testDeps({ catalogue: CATALOGUE });
  const bytes = new Uint8Array([0x7b, 0xff, 0x7d]);
  const res = await makeMcpHandler(deps)(new Request(ENDPOINT, { method: "POST", body: bytes, headers: { "Content-Type": "application/json" } }));
  await rpcErrorOf(res, 400, -32700);
});

test("anything that is not one JSON-RPC 2.0 request or notification is an invalid request (-32600)", async () => {
  const send = server();
  expect((await rpcErrorOf(await send([rpc("ping")]), 400, -32600)).error!.message).toMatch(/Batches/);
  for (const body of [5, "x", null, true]) await rpcErrorOf(await send(JSON.stringify(body)), 400, -32600);
  expect((await rpcErrorOf(await send({ jsonrpc: "1.0", id: 3, method: "ping" }), 400, -32600)).id).toBe(3);
  await rpcErrorOf(await send({ id: 3, method: "ping" }), 400, -32600);
  await rpcErrorOf(await send({ jsonrpc: "2.0", id: 3 }), 400, -32600);
  await rpcErrorOf(await send({ jsonrpc: "2.0", id: 3, method: 9 }), 400, -32600);
  expect((await rpcErrorOf(await send({ jsonrpc: "2.0", id: 3, result: {} }), 400, -32600)).error!.message).toMatch(/not responses/);
  for (const id of [null, {}, [1], true]) {
    const b = await rpcErrorOf(await send({ jsonrpc: "2.0", id, method: "ping" }), 400, -32600);
    expect(b).not.toHaveProperty("id");
  }
});

test("an unknown method is -32601: 200 under the handshake, 404 under 2026-07-28", async () => {
  const send = server();
  await rpcErrorOf(await send(rpc("resources/list")), 200, -32601);
  await rpcErrorOf(await send(rpc("resources/list", { _meta: META }), modernHeaders("resources/list")), 404, -32601);
});

// HTTP.
test("the body is capped: at the cap it is read, one byte over it is 413", async () => {
  const send = server();
  const sized = (n: number) => {
    const base = JSON.stringify(rpc("ping", { pad: "" }));
    return JSON.stringify(rpc("ping", { pad: "x".repeat(n - base.length) }));
  };
  expect(sized(MAX_BODY_BYTES)).toHaveLength(MAX_BODY_BYTES);
  expect((await send(sized(MAX_BODY_BYTES))).status).toBe(200);
  await rpcErrorOf(await send(sized(MAX_BODY_BYTES + 1)), 413, -32600);
});

test("content type and Accept are checked before the body", async () => {
  const send = server();
  await rpcErrorOf(await send(rpc("ping"), { "Content-Type": "text/plain" }), 415, -32600);
  await rpcErrorOf(await send(rpc("ping"), { "Content-Type": "application/x-www-form-urlencoded" }), 415, -32600);
  expect((await send(rpc("ping"), { "Content-Type": "application/json; charset=utf-8" })).status).toBe(200);
  for (const accept of ["text/event-stream", "text/html", "application/json;q=0"]) await rpcErrorOf(await send(rpc("ping"), { Accept: accept }), 406, -32600);
  for (const accept of ["application/json, text/event-stream", "*/*", "application/*", ""]) expect((await send(rpc("ping"), { Accept: accept })).status).toBe(200);
});

// Codex review: a q=0 on application/json was overridden by a wildcard. RFC 9110 12.5.1: the most specific range wins.
test("Accept: JSON's quality comes from the most specific range that matches it", () => {
  for (const no of ["application/json;q=0, */*;q=1", "*/*, application/json; q=0", "application/*;q=0, */*", "text/event-stream", "application/json;q=", "application/xml"]) {
    expect(acceptsJson(no), no).toBe(false);
  }
  for (const yes of [null, "", "*/*", "application/json;q=0.1, */*;q=0", "application/*;q=0, application/json", "text/html;q=0, */*;q=0.5", "Application/JSON"]) {
    expect(acceptsJson(yes), String(yes)).toBe(true);
  }
});

// Codex review: the allowed origin came from Host and X-Forwarded-Host, which the caller controls.
test("Origin must be the configured site's; the request's own host and forwarded headers never vouch for it", async () => {
  vi.stubEnv("SITE_URL", "https://cast.example.test");
  try {
    const send = server();
    expect((await send(rpc("ping"), { Origin: "https://cast.example.test" })).status).toBe(200);
    const forged: Headers[] = [
      { Origin: "https://evil.test" },
      { Origin: "null" },
      { Origin: "http://cast.example.test" },
      { Origin: "https://cf.test" }, // the request URL's own origin
      { Origin: "https://evil.test", "X-Forwarded-Host": "evil.test", "X-Forwarded-Proto": "https" },
      { Origin: "http://evil.test:3000", Host: "evil.test:3000" }, // a rebound name
    ];
    for (const h of forged) {
      const b = await rpcErrorOf(await send(rpc("ping"), h), 403, ORIGIN_REFUSED);
      expect(b, JSON.stringify(h)).not.toHaveProperty("id");
    }
    expect((await send(rpc("ping"))).status).toBe(200); // no Origin: an agent
  } finally {
    vi.unstubAllEnvs();
  }
});

test("GET and DELETE are 405 with Allow: POST", async () => {
  for (const h of [mcpRoute.GET, mcpRoute.DELETE]) {
    const res = await h();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    const b = await answer(res);
    expect(b.error!.code).toBe(POST_ONLY);
    expect(b.error!.message).toMatch(/llms\.txt/);
  }
  expect(mcpRoute.runtime).toBe("nodejs");
  expect(mcpRoute.dynamic).toBe("force-dynamic");
  expect(typeof mcpRoute.POST).toBe("function");
});

test("the limiter counts every POST by IP and answers 429 with Retry-After past its rule", async () => {
  const send = server();
  for (let i = 0; i < RULES.mcp.perIp; i++) expect((await send(rpc("ping", undefined, i))).status).toBe(200);
  const res = await send(rpc("ping"));
  const b = await rpcErrorOf(res, 429, RATE_LIMITED);
  expect(res.headers.get("retry-after")).toBe("3600");
  expect(b.error!.message).toBe("Too many requests. Try again in 60 minutes.");
});

// 2026-07-28 basic/index, Error Codes: -32768 to -32000 is JSON-RPC's; -32000 to -32019 is legacy and -32020 to
// -32099 is the spec's own, so this server's codes sit outside the whole range.
test("the server's own error codes are outside the reserved JSON-RPC range", () => {
  for (const code of [ORIGIN_REFUSED, POST_ONLY, RATE_LIMITED]) {
    expect(Number.isInteger(code)).toBe(true);
    expect(code < -32768 || code > -32000, String(code)).toBe(true);
  }
});

// Protocol versions.
test("under the handshake, MCP-Protocol-Version must name a version it serves", async () => {
  const send = server();
  for (const v of LEGACY_VERSIONS) expect((await tool(await send(rpc("tools/list"), { "MCP-Protocol-Version": v }))).tools).toHaveLength(3);
  const b = await rpcErrorOf(await send(rpc("tools/list"), { "MCP-Protocol-Version": "1999-01-01" }), 400, -32022);
  expect(b.error!.data).toEqual({ supported: [...SUPPORTED_VERSIONS], requested: "1999-01-01" });
  // The current version needs its body metadata.
  await rpcErrorOf(await send(rpc("tools/list"), { "MCP-Protocol-Version": MODERN }), 400, -32020);
});

test("2026-07-28: server/discover, tools/list and tools/call carry resultType, the cache hint and the server's identity", async () => {
  const send = server();
  const serverMeta = { "io.modelcontextprotocol/serverInfo": SERVER_INFO };
  expect(await tool(await send(rpc("server/discover", { _meta: META }), modernHeaders("server/discover")))).toEqual({
    resultType: "complete",
    supportedVersions: [...SUPPORTED_VERSIONS],
    capabilities: { tools: {} },
    instructions: expect.stringContaining("predict_cast"),
    ttlMs: LIST_TTL_MS,
    cacheScope: "public",
    _meta: serverMeta,
  });
  const list = await tool(await send(rpc("tools/list", { _meta: META }), modernHeaders("tools/list")));
  expect(list).toMatchObject({ resultType: "complete", ttlMs: LIST_TTL_MS, cacheScope: "public", _meta: serverMeta });
  expect(list.tools).toHaveLength(3);
  const b = CATALOGUE[1];
  const r = await tool(await send(rpc("tools/call", { name: "predict_cast", arguments: { bottle_id: b.id, skin_lightness: 45 }, _meta: META }), modernHeaders("tools/call", "predict_cast")));
  expect(r).toMatchObject({ resultType: "complete", _meta: serverMeta });
  expect(r.structuredContent.whitening).toEqual(b.tones.find((t) => t.lStar === 45)!.whitening);
  expect((await tool(await send(rpc("ping", { _meta: META }), modernHeaders("ping"))))).toEqual({ resultType: "complete", _meta: serverMeta });
});

test("2026-07-28: headers that do not mirror the body are refused (-32020), an unsupported version is -32022", async () => {
  const send = server();
  const callBody = rpc("tools/call", { name: "predict_cast", arguments: { bottle_id: CATALOGUE[0].id, skin_lightness: 55 }, _meta: META });
  const b64 = (s: string) => `=?base64?${Buffer.from(s, "utf8").toString("base64")}?=`;
  expect((await send(callBody, modernHeaders("tools/call", b64("predict_cast")))).status).toBe(200);
  for (const name of [undefined, "list_bottles", b64("list_bottles"), "=?base64?a?=", "=?base64?/w==?="]) {
    const b = await rpcErrorOf(await send(callBody, modernHeaders("tools/call", name)), 400, -32020);
    expect(b.id).toBe(1);
  }
  await rpcErrorOf(await send(callBody, { "Mcp-Method": "tools/call", "Mcp-Name": "predict_cast" }), 400, -32020);
  await rpcErrorOf(await send(callBody, { ...modernHeaders("tools/call", "predict_cast"), "MCP-Protocol-Version": LEGACY_VERSIONS[0] }), 400, -32020);
  await rpcErrorOf(await send(callBody, { ...modernHeaders("tools/list", "predict_cast") }), 400, -32020);
  await rpcErrorOf(await send(callBody, { "MCP-Protocol-Version": MODERN, "Mcp-Name": "predict_cast" }), 400, -32020);

  const old = { "io.modelcontextprotocol/protocolVersion": "1900-01-01", "io.modelcontextprotocol/clientCapabilities": {} };
  const b = await rpcErrorOf(await send(rpc("tools/list", { _meta: old }), { ...modernHeaders("tools/list"), "MCP-Protocol-Version": "1900-01-01" }), 400, -32022);
  expect(b.error).toEqual({ code: -32022, message: "Unsupported protocol version", data: { supported: [...SUPPORTED_VERSIONS], requested: "1900-01-01" } });

  await rpcErrorOf(await send(rpc("tools/list", { _meta: { ...META, "io.modelcontextprotocol/clientCapabilities": [] } }), modernHeaders("tools/list")), 400, -32602);
  await rpcErrorOf(await send(rpc("tools/list", { _meta: { ...META, "io.modelcontextprotocol/protocolVersion": 2026 } }), modernHeaders("tools/list")), 400, -32602);
});

// Codex review. basic/index: clientCapabilities is required on every request; a request without it is malformed,
// -32602 with 400.
test("2026-07-28: a request without clientCapabilities is refused, 400 and -32602", async () => {
  const send = server();
  const versionOnly = { "io.modelcontextprotocol/protocolVersion": MODERN };
  for (const method of ["ping", "tools/list", "server/discover"]) {
    const b = await rpcErrorOf(await send(rpc(method, { _meta: versionOnly }), modernHeaders(method)), 400, -32602);
    expect(b.error!.message).toMatch(/clientCapabilities is required/);
  }
  const nulled = { ...versionOnly, "io.modelcontextprotocol/clientCapabilities": null };
  await rpcErrorOf(await send(rpc("ping", { _meta: nulled }), modernHeaders("ping")), 400, -32602);
});

test("Mcp-Name values decode from the base64 sentinel, and a malformed sentinel is no value", () => {
  expect(decodeHeaderValue(null)).toBeNull();
  expect(decodeHeaderValue("predict_cast")).toBe("predict_cast");
  expect(decodeHeaderValue("=?base64?SGVsbG8sIOS4lueVjA==?=")).toBe("Hello, \u4e16\u754c"); // the spec's own example
  expect(decodeHeaderValue("=?base64?abc?=")).toBeNull();
  expect(decodeHeaderValue("=?base64?/w==?=")).toBeNull(); // not UTF-8
});

// Codex review: the default TextDecoder dropped a leading BOM, so "\uFEFFpredict_cast" matched "predict_cast".
test("a base64 Mcp-Name keeps a leading BOM, so it does not match a body without one", async () => {
  const bom = `=?base64?${Buffer.from("\uFEFFpredict_cast", "utf8").toString("base64")}?=`;
  expect(bom).toBe("=?base64?77u/cHJlZGljdF9jYXN0?=");
  expect(decodeHeaderValue(bom)).toBe("\uFEFFpredict_cast");
  const callBody = rpc("tools/call", { name: "predict_cast", arguments: { bottle_id: CATALOGUE[0].id, skin_lightness: 55 }, _meta: META });
  await rpcErrorOf(await server()(callBody, modernHeaders("tools/call", bom)), 400, -32020);
});

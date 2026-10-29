import { expect, test } from "vitest";
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
  SERVER_INFO,
  SUPPORTED_VERSIONS,
  decodeHeaderValue,
  makeMcpHandler,
} from "@/server/routes/mcp";
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
    [{ bottle_id: "no-such-bottle", skin_lightness: 55 }, /unknown bottle_id "no-such-bottle"/],
    [{ bottle_id: "x".repeat(200), skin_lightness: 55 }, /unknown bottle_id "x{64}\.\.\."/],
    [{ bottle_id: id, skin_lightness: 55, tone: "light" }, /unknown argument "tone"/],
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
    [`{"bottle_id":"${id}","skin_lightness":55,"__proto__":{"x":1}}`, /unknown argument "__proto__"/],
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
    expect(bad.content[0].text).toBe(`${name} takes no arguments (got "x").`);
  }
});

test("an unknown tool and a malformed tools/call are protocol errors (-32602)", async () => {
  const send = server();
  expect((await rpcErrorOf(await send(call("predict_tan", {})), 200, -32602)).error!.message).toBe('Unknown tool: "predict_tan"');
  await rpcErrorOf(await send(rpc("tools/call", { arguments: {} })), 200, -32602);
  await rpcErrorOf(await send(rpc("tools/call", { name: 5 })), 200, -32602);
  for (const args of [[], "x", null, 3]) await rpcErrorOf(await send(call("predict_cast", args)), 200, -32602);
  await rpcErrorOf(await send(rpc("tools/list", { cursor: "next" })), 200, -32602);
  await rpcErrorOf(await send(rpc("ping", [1] as unknown as object)), 200, -32602);
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

test("content type, Accept and Origin are checked before the body", async () => {
  const send = server();
  await rpcErrorOf(await send(rpc("ping"), { "Content-Type": "text/plain" }), 415, -32600);
  await rpcErrorOf(await send(rpc("ping"), { "Content-Type": "application/x-www-form-urlencoded" }), 415, -32600);
  expect((await send(rpc("ping"), { "Content-Type": "application/json; charset=utf-8" })).status).toBe(200);
  for (const accept of ["text/event-stream", "text/html", "application/json;q=0"]) await rpcErrorOf(await send(rpc("ping"), { Accept: accept }), 406, -32600);
  for (const accept of ["application/json, text/event-stream", "*/*", "application/*", ""]) expect((await send(rpc("ping"), { Accept: accept })).status).toBe(200);
  for (const origin of ["https://evil.test", "null", "http://cf.test"]) {
    const b = await rpcErrorOf(await send(rpc("ping"), { Origin: origin }), 403, -32000);
    expect(b).not.toHaveProperty("id");
  }
  expect((await send(rpc("ping"), { Origin: "https://cf.test" })).status).toBe(200);
});

test("GET and DELETE are 405 with Allow: POST", async () => {
  for (const h of [mcpRoute.GET, mcpRoute.DELETE]) {
    const res = await h();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect((await answer(res)).error!.message).toMatch(/llms\.txt/);
  }
  expect(mcpRoute.runtime).toBe("nodejs");
  expect(mcpRoute.dynamic).toBe("force-dynamic");
  expect(typeof mcpRoute.POST).toBe("function");
});

test("the limiter counts every POST by IP and answers 429 with Retry-After past its rule", async () => {
  const send = server();
  for (let i = 0; i < RULES.mcp.perIp; i++) expect((await send(rpc("ping", undefined, i))).status).toBe(200);
  const res = await send(rpc("ping"));
  const b = await rpcErrorOf(res, 429, -32000);
  expect(res.headers.get("retry-after")).toBe("3600");
  expect(b.error!.message).toBe("Too many requests. Try again in 60 minutes.");
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

test("Mcp-Name values decode from the base64 sentinel, and a malformed sentinel is no value", () => {
  expect(decodeHeaderValue(null)).toBeNull();
  expect(decodeHeaderValue("predict_cast")).toBe("predict_cast");
  expect(decodeHeaderValue("=?base64?SGVsbG8sIOS4lueVjA==?=")).toBe("Hello, 世界"); // the spec's own example
  expect(decodeHeaderValue("=?base64?abc?=")).toBeNull();
  expect(decodeHeaderValue("=?base64?/w==?=")).toBeNull(); // not UTF-8
});

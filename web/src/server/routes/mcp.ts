import "server-only";
import { RELEASE } from "@/lib/release";
import { siteUrl } from "@/lib/site";
import type { RouteDeps } from "@/server/deps";
import { clientIp } from "@/server/limits";
import { INSTRUCTIONS, TOOLS, type ToolResult, callTool } from "@/server/mcpTools";
import { mediaType, readCapped, waitText } from "@/server/routes/common";

/**
 * POST /api/mcp: a stateless MCP server over Streamable HTTP. One JSON-RPC message per POST, one JSON answer, no SSE,
 * no session (an Mcp-Session-Id is ignored, none is minted). It serves both eras of the protocol, per request:
 * - 2026-07-28 (current): every request carries its version in params._meta, mirrored in the MCP-Protocol-Version,
 *   Mcp-Method and Mcp-Name headers, which must match the body; server/discover is the optional first call.
 * - 2025-11-25 and earlier: initialize negotiates a version and notifications/initialized is acknowledged, though
 *   nothing is kept between requests; a request without MCP-Protocol-Version is read as 2025-03-26, as the spec allows.
 * Specs read 2026-10-29 at modelcontextprotocol.io and schema/*.ts in modelcontextprotocol/modelcontextprotocol.
 */

export const MODERN_VERSIONS: readonly string[] = ["2026-07-28"];
export const LEGACY_VERSIONS: readonly string[] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const SUPPORTED_VERSIONS: readonly string[] = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
/** What a request with no MCP-Protocol-Version header is served as. */
const UNDECLARED_VERSION = "2025-03-26";
/** Largest request body read. A tools/call with full 2026-07-28 metadata is well under 1 KB. */
export const MAX_BODY_BYTES = 4096;
/** How long a client may cache tools/list and server/discover: the tools change only with a deploy. */
export const LIST_TTL_MS = 3_600_000;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_PROTOCOL_VERSION = -32022;
// This server's own refusals. The spec reserves -32768 to -32000 (-32000 to -32019 are legacy, not for new
// implementations), so application codes sit outside it: -31000 less the HTTP status they come with.
export const ORIGIN_REFUSED = -31403;
export const POST_ONLY = -31405;
export const RATE_LIMITED = -31429;

const VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";
export const SERVER_INFO = { name: "cast-forecast", title: "Cast Forecast", version: RELEASE } as const;
const CAPABILITIES = { tools: {} };
const NO_STORE = { "Cache-Control": "no-store" } as const;
const IDENT = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

type Id = string | number;
type Json = Record<string, unknown>;
type Era = "modern" | "legacy";

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const has = (o: Json, k: string) => Object.hasOwn(o, k);
const short = (s: string) => JSON.stringify(s.length > 64 ? `${s.slice(0, 64)}...` : s);

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** A JSON-RPC error response; `id` is left out when the request's id is unknown or unusable. */
function rpcError(status: number, id: Id | undefined, code: number, message: string, data?: unknown, headers?: Record<string, string>): Response {
  const error = data === undefined ? { code, message } : { code, message, data };
  return json(status, id === undefined ? { jsonrpc: "2.0", error } : { jsonrpc: "2.0", id, error }, headers);
}

/** A result. 2026-07-28 results carry resultType and the server's identity in _meta; legacy results carry neither. */
function rpcResult(id: Id, era: Era, result: Json): Response {
  const body = era === "modern" ? { resultType: "complete", ...result, _meta: { [SERVER_INFO_KEY]: SERVER_INFO } } : result;
  return json(200, { jsonrpc: "2.0", id, result: body });
}

/** GET (the old standalone SSE stream) and DELETE (the old session end): 405, as the spec asks, with a pointer. */
export async function methodNotAllowed(): Promise<Response> {
  return rpcError(405, undefined, POST_ONLY, "POST one JSON-RPC message to this endpoint. See /llms.txt.", undefined, { Allow: "POST" });
}

/**
 * True when there is no Origin, or it is the configured site's (siteUrl: SITE_URL, else the Vercel production host).
 * Never read from Host or X-Forwarded-Host, which a rebound or forged request controls (Codex review). The spec answers
 * an invalid Origin 403. No page calls this endpoint, and agents send no Origin.
 */
function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  try {
    return origin === new URL(siteUrl()).origin;
  } catch {
    return false;
  }
}

/**
 * False only for an Accept header that rules JSON out; a missing one, or curl's default, accepts it. JSON's quality is
 * that of the most specific range that matches it (RFC 9110 12.5.1): a q=0 on application/json beats any wildcard.
 */
export function acceptsJson(accept: string | null): boolean {
  if (accept === null || accept.trim() === "") return true;
  let rank = 0;
  let quality = 0;
  for (const part of accept.split(",")) {
    const [range, ...params] = part.split(";").map((s) => s.trim().toLowerCase());
    const r = range === "application/json" ? 3 : range === "application/*" ? 2 : range === "*/*" ? 1 : 0;
    if (r === 0 || r < rank) continue;
    const q = params.find((p) => p.startsWith("q="));
    const value = q === undefined ? 1 : Number(q.slice(2));
    const v = Number.isFinite(value) ? value : 1;
    quality = r > rank ? v : Math.max(quality, v);
    rank = r;
  }
  return quality > 0;
}

/** An Mcp-Name value with the spec's =?base64?...?= sentinel decoded, or null when the header is absent or malformed. */
export function decodeHeaderValue(raw: string | null): string | null {
  if (raw === null) return null;
  const m = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(raw);
  if (!m) return raw;
  if (m[1].length % 4 !== 0) return null;
  try {
    // ignoreBOM keeps a leading U+FEFF, so a name that differs from the body only by one still fails the comparison.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(m[1], "base64"));
  } catch {
    return null;
  }
}

function logUnexpected(e: unknown): void {
  const raw = e instanceof Error ? e.name : typeof e;
  console.error(`[api/mcp] unexpected failure: ${IDENT.test(raw) ? raw : "Error"}`);
}

/** POST handler. The limiter runs before the body is read, so a refused caller costs no read. */
export function makeMcpHandler(deps: () => RouteDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (!originAllowed(req)) return rpcError(403, undefined, ORIGIN_REFUSED, "Origin not allowed.");
    const d = deps();
    const limit = d.limiter.take("mcp", null, clientIp(req), d.now());
    if (!limit.ok) {
      const wait = { "Retry-After": String(limit.retryAfterS) };
      return rpcError(429, undefined, RATE_LIMITED, `Too many requests. Try again in ${waitText(limit.retryAfterS)}.`, undefined, wait);
    }
    if (mediaType(req) !== "application/json") return rpcError(415, undefined, INVALID_REQUEST, "Send Content-Type: application/json.");
    if (!acceptsJson(req.headers.get("accept"))) return rpcError(406, undefined, INVALID_REQUEST, "This server answers in application/json.");
    const bytes = await readCapped(req, MAX_BODY_BYTES);
    if (bytes === "too_large") return rpcError(413, undefined, INVALID_REQUEST, `The body is over ${MAX_BODY_BYTES} bytes.`);
    if (bytes === null) return rpcError(400, undefined, PARSE_ERROR, "The body could not be read.");
    let message: unknown;
    try {
      message = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return rpcError(400, undefined, PARSE_ERROR, "Parse error: the body is not UTF-8 JSON.");
    }
    try {
      return dispatch(message, req.headers, d);
    } catch (e) {
      logUnexpected(e);
      const id = isObject(message) && (typeof message.id === "string" || typeof message.id === "number") ? message.id : undefined;
      return rpcError(500, id, INTERNAL_ERROR, "Internal error.");
    }
  };
}

function dispatch(message: unknown, headers: Headers, d: RouteDeps): Response {
  if (Array.isArray(message)) return rpcError(400, undefined, INVALID_REQUEST, "Batches are not supported: send one message per POST.");
  if (!isObject(message)) return rpcError(400, undefined, INVALID_REQUEST, "Invalid request: expected a JSON-RPC object.");
  const raw = message.id;
  const id = typeof raw === "string" || (typeof raw === "number" && Number.isFinite(raw)) ? raw : undefined;
  if (message.jsonrpc !== "2.0") return rpcError(400, id, INVALID_REQUEST, 'Invalid request: jsonrpc must be "2.0".');
  if (typeof message.method !== "string") {
    const response = has(message, "result") || has(message, "error");
    return rpcError(400, id, INVALID_REQUEST, response ? "This endpoint takes requests, not responses." : "Invalid request: method must be a string.");
  }
  const method = message.method;
  // A notification (no id). notifications/initialized and any other is accepted and needs nothing kept.
  if (!has(message, "id")) return new Response(null, { status: 202, headers: NO_STORE });
  if (id === undefined) return rpcError(400, undefined, INVALID_REQUEST, "Invalid request: id must be a string or a number.");
  if (has(message, "params") && !isObject(message.params)) return rpcError(200, id, INVALID_PARAMS, "params must be an object.");
  const params: Json = isObject(message.params) ? message.params : {};

  // An initialize request selects the legacy era, whatever else it carries.
  if (method === "initialize") return initialize(id, params);
  const meta = isObject(params._meta) ? params._meta : undefined;
  if (meta && has(meta, VERSION_KEY)) return modern(id, method, params, meta, headers, d);
  return legacy(id, method, params, headers, d);
}

function initialize(id: Id, params: Json): Response {
  const requested = params.protocolVersion;
  if (typeof requested !== "string") return rpcError(200, id, INVALID_PARAMS, "initialize needs params.protocolVersion (a string).");
  // The requested version when it is one the handshake serves, else the newest that is.
  const protocolVersion = LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0];
  return rpcResult(id, "legacy", { protocolVersion, capabilities: CAPABILITIES, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
}

/** 2026-07-28: the body's version, the headers that mirror the body, then the method. */
function modern(id: Id, method: string, params: Json, meta: Json, headers: Headers, d: RouteDeps): Response {
  const declared = meta[VERSION_KEY];
  if (typeof declared !== "string") return rpcError(400, id, INVALID_PARAMS, `_meta ${VERSION_KEY} must be a string.`);
  const header = headers.get("mcp-protocol-version");
  if (header !== declared) {
    const got = header === null ? "is missing" : `is ${short(header)}`;
    return rpcError(400, id, HEADER_MISMATCH, `Header mismatch: MCP-Protocol-Version ${got}; the body says ${short(declared)}.`);
  }
  if (!MODERN_VERSIONS.includes(declared)) {
    return rpcError(400, id, UNSUPPORTED_PROTOCOL_VERSION, "Unsupported protocol version", { supported: SUPPORTED_VERSIONS, requested: declared });
  }
  const mcpMethod = headers.get("mcp-method");
  if (mcpMethod !== method) {
    const got = mcpMethod === null ? "is missing" : `is ${short(mcpMethod)}`;
    return rpcError(400, id, HEADER_MISMATCH, `Header mismatch: Mcp-Method ${got}; the body says ${short(method)}.`);
  }
  // Required on every request (basic/index, per-request protocol fields): missing is malformed, 400 and -32602.
  if (!has(meta, CAPABILITIES_KEY) || !isObject(meta[CAPABILITIES_KEY])) {
    return rpcError(400, id, INVALID_PARAMS, `_meta ${CAPABILITIES_KEY} is required, an object ({} for none).`);
  }
  if (method === "tools/call" && typeof params.name === "string") {
    const name = decodeHeaderValue(headers.get("mcp-name"));
    if (name !== params.name) {
      const got = name === null ? "is missing or malformed" : `is ${short(name)}`;
      return rpcError(400, id, HEADER_MISMATCH, `Header mismatch: Mcp-Name ${got}; the body says ${short(params.name)}.`);
    }
  }
  switch (method) {
    case "server/discover":
      return rpcResult(id, "modern", {
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: CAPABILITIES,
        instructions: INSTRUCTIONS,
        ttlMs: LIST_TTL_MS,
        cacheScope: "public",
      });
    case "ping":
    case "tools/list":
    case "tools/call":
      return common(id, "modern", method, params, d);
    default:
      // The spec answers an unknown method 404 in this revision.
      return rpcError(404, id, METHOD_NOT_FOUND, `Method not found: ${short(method)}`);
  }
}

/** 2025-11-25 and earlier: the header, when sent, must name a version this era serves. */
function legacy(id: Id, method: string, params: Json, headers: Headers, d: RouteDeps): Response {
  const header = headers.get("mcp-protocol-version");
  if (header !== null && MODERN_VERSIONS.includes(header)) {
    return rpcError(400, id, HEADER_MISMATCH, `Header mismatch: MCP-Protocol-Version is ${short(header)} but params._meta has no ${VERSION_KEY}.`);
  }
  const version = header ?? UNDECLARED_VERSION;
  if (!LEGACY_VERSIONS.includes(version)) {
    return rpcError(400, id, UNSUPPORTED_PROTOCOL_VERSION, "Unsupported protocol version", { supported: SUPPORTED_VERSIONS, requested: version });
  }
  if (method === "ping" || method === "tools/list" || method === "tools/call") return common(id, "legacy", method, params, d);
  return rpcError(200, id, METHOD_NOT_FOUND, `Method not found: ${short(method)}`);
}

/** ping, tools/list and tools/call, the same in both eras apart from the result's envelope. */
function common(id: Id, era: Era, method: string, params: Json, d: RouteDeps): Response {
  if (method === "ping") return rpcResult(id, era, {});
  if (method === "tools/list") {
    if (has(params, "cursor")) return rpcError(200, id, INVALID_PARAMS, "Invalid cursor: the tool list has one page.");
    return rpcResult(id, era, era === "modern" ? { tools: TOOLS, ttlMs: LIST_TTL_MS, cacheScope: "public" } : { tools: TOOLS });
  }
  const name = params.name;
  if (typeof name !== "string") return rpcError(200, id, INVALID_PARAMS, "tools/call needs params.name (a string).");
  const args = params.arguments;
  if (args !== undefined && !isObject(args)) {
    return rpcError(200, id, INVALID_PARAMS, `Invalid arguments for tool ${short(name)}: arguments must be an object.`);
  }
  const out: ToolResult | null = callTool(name, args ?? {}, d.catalogue);
  if (out === null) return rpcError(200, id, INVALID_PARAMS, `Unknown tool: ${short(name)}`);
  return rpcResult(id, era, out);
}

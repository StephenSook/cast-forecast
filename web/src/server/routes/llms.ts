import "server-only";
import { MCP_PATH, mcpCurl, predictCastCurl, predictExample, rpcBody, searchLabelsCurl } from "@/lib/agent";
import { DATA_URL, REPO, originFrom } from "@/lib/evidence";
import { TOOLS } from "@/server/mcpTools";
import { LEGACY_VERSIONS, MODERN_VERSIONS, SUPPORTED_VERSIONS } from "@/server/routes/mcp";

const ACCEPT = "Accept: application/json, text/event-stream";

/**
 * /llms.txt (llmstxt.org): what the site is, the MCP endpoint, its tools and curls that run as printed against
 * `base`. Tool lines come from the tool definitions and the example from the catalogue, so this file cannot drift
 * from what the endpoint serves.
 */
export function llmsText(base: string): string {
  const modern = MODERN_VERSIONS[0];
  const legacy = LEGACY_VERSIONS[0];
  const meta = { "io.modelcontextprotocol/protocolVersion": modern, "io.modelcontextprotocol/clientCapabilities": {} };
  const modernHeaders = (method: string, name?: string) =>
    [ACCEPT, `MCP-Protocol-Version: ${modern}`, `Mcp-Method: ${method}`, ...(name ? [`Mcp-Name: ${name}`] : [])];
  const initialize = { protocolVersion: legacy, capabilities: {}, clientInfo: { name: "curl", version: "1" } };
  const call = { name: "predict_cast", arguments: predictExample() };
  return [
    "# Cast Forecast",
    "",
    "> Predicts how white a mineral (zinc oxide) sunscreen will look on a shopper's skin, as a CIELAB L* change, from " +
      "the zinc oxide percent on its FDA label. The model is linear, fitted to the raw data of Maldonado Lopez et al., " +
      "PLOS ONE 2025 (CC BY 4.0). Appearance only.",
    "",
    "## MCP server",
    "",
    `- Endpoint: ${base}${MCP_PATH} (Streamable HTTP: POST one JSON-RPC message, get one JSON answer). No key, no session, no cost.`,
    `- Protocol versions: ${SUPPORTED_VERSIONS.join(", ")}. ${modern} requests carry their version in params._meta and ` +
      `the MCP-Protocol-Version, Mcp-Method and Mcp-Name headers; older clients start with initialize.`,
    ...TOOLS.map((t) => `- ${t.name}: ${t.description}`),
    "",
    "## Try it",
    "",
    "Predict one bottle on one skin tone:",
    "",
    predictCastCurl(base),
    "",
    "Find a label by brand or name (its id goes to predict_cast as bottle_id):",
    "",
    searchLabelsCurl(base),
    "",
    `Initialize (${legacy}), then list the tools:`,
    "",
    mcpCurl(base, rpcBody(1, "initialize", initialize), [ACCEPT]),
    mcpCurl(base, rpcBody(2, "tools/list"), [ACCEPT, `MCP-Protocol-Version: ${legacy}`]),
    "",
    `The same with ${modern} request metadata:`,
    "",
    mcpCurl(base, rpcBody(3, "server/discover", { _meta: meta }), modernHeaders("server/discover")),
    mcpCurl(base, rpcBody(4, "tools/call", { ...call, _meta: meta }), modernHeaders("tools/call", "predict_cast")),
    "",
    "## Also",
    "",
    `- [GET /api/label-model](${base}/api/label-model): refits the label model from the study table and recomputes Gate 1's held-out error.`,
    `- [GET /api/gates](${base}/api/gates): the gates table and the K1b render curve check.`,
    `- [Evidence](${base}/evidence): every gate result, pass or fail.`,
    `- [Data](${DATA_URL}): the study table and the pinned FDA labels.`,
    `- [Code](${REPO})`,
    "",
  ].join("\n");
}

/** GET /llms.txt: plain text whose curls point at the origin the request came to. */
export function makeLlmsHandler(): (req: Request) => Promise<Response> {
  return async (req) =>
    new Response(llmsText(originFrom(req.headers)), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
}

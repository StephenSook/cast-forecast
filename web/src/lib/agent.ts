import { CATALOGUE, TONES } from "@/lib/catalogue";
import { ZINC_RANGE } from "@/lib/labelModel";

/** The MCP endpoint (src/app/api/mcp/route.ts). */
export const MCP_PATH = "/api/mcp";

/**
 * The predict_cast arguments every printed curl uses: the first catalogue bottle on the middle site tone (L* 55 in
 * the shipped file), the one number /compare shows for it. With no bottle, the study's lowest zinc percent instead.
 */
export function predictExample(): { bottle_id: string; skin_lightness: number } | { zinc_oxide_pct: number; skin_lightness: number } {
  const skin_lightness = TONES[Math.floor(TONES.length / 2)].lStar;
  const first = CATALOGUE[0];
  return first ? { bottle_id: first.id, skin_lightness } : { zinc_oxide_pct: ZINC_RANGE[0], skin_lightness };
}

/** One JSON-RPC request body, as the printed curls send it. */
export function rpcBody(id: number, method: string, params?: object): string {
  return JSON.stringify(params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params });
}

/** A copy-paste curl that POSTs `body` to the MCP endpoint at `base`. Bodies hold no single quote, so one pair wraps them. */
export function mcpCurl(base: string, body: string, headers: readonly string[] = []): string {
  const h = ["Content-Type: application/json", ...headers].map((x) => ` -H '${x}'`).join("");
  return `curl -s ${base}${MCP_PATH}${h} -d '${body}'`;
}

/** The predict_cast call the evidence page prints. */
export function predictCastCurl(base: string): string {
  return mcpCurl(base, rpcBody(1, "tools/call", { name: "predict_cast", arguments: predictExample() }));
}

/** The search_labels arguments llms.txt prints: a word most mineral sunscreen names carry, and a short page. */
export const SEARCH_EXAMPLE = { query: "mineral", limit: 5 } as const;

/** The search_labels call llms.txt prints. */
export function searchLabelsCurl(base: string): string {
  return mcpCurl(base, rpcBody(1, "tools/call", { name: "search_labels", arguments: SEARCH_EXAMPLE }));
}

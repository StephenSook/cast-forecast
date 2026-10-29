import { expect, test } from "vitest";
import * as llmsRoute from "@/app/llms.txt/route";
import { predictCastCurl, searchLabelsCurl } from "@/lib/agent";
import { CATALOGUE } from "@/lib/catalogue";
import { LABELS } from "@/server/labels";
import { TOOLS } from "@/server/mcpTools";
import { llmsText } from "@/server/routes/llms";
import { SUPPORTED_VERSIONS, makeMcpHandler } from "@/server/routes/mcp";
import { findCopyViolations } from "../helpers/copyGuard";
import { testDeps } from "../helpers/routes";

const BASE = "https://cf.test";

/** Each printed curl as the request it sends: its -H headers and its -d body, both single-quoted in the text. */
function curls(text: string): { line: string; headers: Record<string, string>; body: string }[] {
  return text
    .split("\n")
    .filter((l) => l.startsWith("curl "))
    .map((line) => {
      expect(line.startsWith(`curl -s ${BASE}/api/mcp -H `), line).toBe(true);
      const headers: Record<string, string> = {};
      for (const m of line.matchAll(/ -H '([^':]+): ([^']*)'/g)) headers[m[1]] = m[2];
      const body = /-d '([^']*)'$/.exec(line)![1];
      return { line, headers, body };
    });
}

test("llms.txt names the endpoint, every tool, every protocol version and the label-model check", () => {
  const text = llmsText(BASE);
  expect(text.startsWith("# Cast Forecast\n\n> ")).toBe(true);
  expect(text).toContain(`Endpoint: ${BASE}/api/mcp`);
  for (const t of TOOLS) expect(text).toContain(`- ${t.name}: ${t.description}`);
  expect(text).toContain(SUPPORTED_VERSIONS.join(", "));
  expect(text).toContain(`[GET /api/label-model](${BASE}/api/label-model)`);
  expect(text).toContain(predictCastCurl(BASE));
  expect(text).toContain(searchLabelsCurl(BASE));
  expect(findCopyViolations(text, "llms.txt")).toEqual([]);
  expect(text).not.toMatch(/[\u2018\u2019\u201c\u201d]/); // curly quotes, written as escapes
});

test("every curl llms.txt prints runs as printed and answers a result", async () => {
  const { deps } = testDeps({ catalogue: CATALOGUE, labels: LABELS });
  const handler = makeMcpHandler(deps);
  const printed = curls(llmsText(BASE));
  expect(printed.length).toBe(6);
  for (const c of printed) {
    const res = await handler(new Request(`${BASE}/api/mcp`, { method: "POST", headers: c.headers, body: c.body }));
    expect(res.status, c.line).toBe(200);
    const b = await res.json();
    expect(b.error, c.line).toBeUndefined();
    expect(b.result.isError, c.line).toBeUndefined();
    // The printed search finds labels in the shipped catalogue.
    if (c.body.includes('"search_labels"')) expect(b.result.structuredContent.labels.length).toBeGreaterThan(0);
  }
});

test("the llms.txt route answers plain text whose curls point at the request's origin", async () => {
  expect(llmsRoute.dynamic).toBe("force-dynamic");
  const res = await llmsRoute.GET(new Request("https://cast.example.test/llms.txt", { headers: { host: "cast.example.test", "x-forwarded-proto": "https" } }));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(await res.text()).toContain("curl -s https://cast.example.test/api/mcp ");
});

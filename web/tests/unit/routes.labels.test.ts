import { expect, test } from "vitest";
import * as labelsRoute from "@/app/api/labels/route";
import { BottleSchema } from "@/lib/catalogue";
import { MESSAGES } from "@/lib/messages";
import { SEARCH_LIMIT } from "@/server/labels";
import { MAX_QUERY, makeLabelsHandler } from "@/server/routes/labels";
import { testEntry } from "../helpers/entries";

const get = (q?: string) => new Request(`https://cf.test/api/labels${q === undefined ? "" : `?${new URLSearchParams({ q })}`}`);

test("a query answers the matching entries, whole, with the total", async () => {
  const list = Array.from({ length: 12 }, (_, i) => testEntry({ id: `test-${i}`, name: `Test entry ${i}` }));
  const res = await makeLabelsHandler(list)(get("test entry"));
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=86400");
  const body = await res.json();
  expect(body.total).toBe(12);
  expect(body.bottles).toHaveLength(SEARCH_LIMIT);
  expect(body.bottles[0]).toEqual(list[0]);
});

test("a missing, blank or overlong query is a 400 bad_request", async () => {
  for (const q of [undefined, "", "   ", "%%", "x".repeat(MAX_QUERY + 1)]) {
    const res = await makeLabelsHandler([testEntry()])(get(q));
    expect(res.status, String(q)).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "bad_request", message: MESSAGES.bad_request } });
  }
});

test("the shipped route searches the full catalogue and every result is a valid entry", async () => {
  const res = await labelsRoute.GET(get("blue lizard"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.total).toBeGreaterThanOrEqual(3);
  for (const b of body.bottles) expect(BottleSchema.parse(b)).toEqual(b);
  expect(labelsRoute.runtime).toBe("nodejs");
});

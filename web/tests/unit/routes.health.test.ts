import { expect, test } from "vitest";
import * as healthRoute from "@/app/api/health/route";
import { RELEASE } from "@/lib/release";
import { makeHealthHandler } from "@/server/routes/health";
import { KEY, SECRET } from "../helpers/constants";
import { testEntry } from "../helpers/entries";
import { get, testDeps } from "../helpers/routes";

test("health reports booleans, counts and the Node version, never the key or secret", async () => {
  const { deps } = testDeps();
  const s = await (await makeHealthHandler(deps)(get("/api/health"))).text();
  expect(s).not.toContain(KEY); expect(s).not.toContain(SECRET);
  expect(JSON.parse(s)).toEqual({ release: RELEASE, youcam: true, session: true, bottles: 0, gates: 5, node: process.versions.node });
});
test("health reports youcam and session false without them", async () => {
  const { deps } = testDeps({ env: { youcamKey: null, sessionSecret: null } });
  expect(await (await makeHealthHandler(deps)(get("/api/health"))).json()).toMatchObject({ youcam: false, session: false });
});

// Beyond the brief.
test("health counts the catalogue it is given, calls nothing and is not cached", async () => {
  const { deps, ff } = testDeps({ catalogue: [testEntry(), testEntry({ id: "test-b" })] });
  const res = await makeHealthHandler(deps)(get("/api/health"));
  expect((await res.json()).bottles).toBe(2); expect(res.headers.get("cache-control")).toBe("no-store"); expect(ff.calls).toEqual([]);
});
test("health route config: nodejs, force-dynamic", () => {
  expect(healthRoute.runtime).toBe("nodejs");
  expect(healthRoute.dynamic).toBe("force-dynamic");
  expect(typeof healthRoute.GET).toBe("function");
});

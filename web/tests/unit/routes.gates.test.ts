import { expect, test } from "vitest";
import * as gatesRoute from "@/app/api/gates/route";
import { K1B, loadGates } from "@/lib/gates";
import { RELEASE } from "@/lib/release";
import { gatesPayload, makeGatesHandler } from "@/server/routes/gates";

test("gates recomputes 29, 49 and 73 and every entry matches", () => {
  const p = gatesPayload();
  expect(p.k1b.inverseCheck.map((c) => c.recomputed)).toEqual([29, 49, 73]);
  expect(p.k1b.inverseCheck.every((c) => c.match)).toBe(true);
  expect(p.gates.map((g) => g.verdict)).toEqual(["FAIL", "FAIL", "FAIL", "PASS", "OTHER"]);
});
test("makeGatesHandler serves the payload as JSON", async () => {
  const res = await makeGatesHandler()();
  expect(res.status).toBe(200); expect(await res.json()).toEqual(JSON.parse(JSON.stringify(gatesPayload())));
});

// Beyond the brief.
test("the payload carries the K1b summary, the curve as sorted pairs, and the release", () => {
  const p = gatesPayload();
  expect(p.release).toBe(RELEASE);
  expect(p.gates).toEqual(loadGates());
  expect(p.k1b).toMatchObject({ pass: K1B.pass, r2: K1B.r2, g100: K1B.g100, inverseGatingDe00: K1B.inverseGatingDe00, unitsSpent: K1B.unitsSpent });
  expect(p.k1b.g).toEqual([...K1B.g.entries()]);
  expect(p.k1b.g.map(([k]) => k)).toEqual([0, 20, 40, 60, 80, 100]);
  expect(p.k1b.inverseCheck.map((c) => [c.target, c.recorded])).toEqual(K1B.inversePlan.map((r) => [r.targetAlpha, r.colorIntensity]));
});
test("a recorded intensity that disagrees with the recomputation is reported as no match", async () => {
  const p = gatesPayload();
  const tampered = { ...p, k1b: { ...p.k1b, inverseCheck: p.k1b.inverseCheck.map((c, i) => (i === 0 ? { ...c, recorded: 30, match: false } : c)) } };
  expect((await (await makeGatesHandler(() => tampered)()).json()).k1b.inverseCheck[0]).toEqual({ ...p.k1b.inverseCheck[0], recorded: 30, match: false });
});
test("gates route config: nodejs, force-static, GET serves the payload", async () => {
  expect(gatesRoute.runtime).toBe("nodejs");
  expect(gatesRoute.dynamic).toBe("force-static");
  expect(await (await gatesRoute.GET()).json()).toEqual(JSON.parse(JSON.stringify(gatesPayload())));
});

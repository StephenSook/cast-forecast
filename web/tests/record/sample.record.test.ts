import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { CATALOGUE, TONES } from "@/lib/catalogue";
import { createBalanceCache } from "@/server/credits";
import type { RouteDeps } from "@/server/deps";
import { LABELS } from "@/server/labels";
import { createLimiter } from "@/server/limits";
import { createYouCam } from "@/server/youcam";
import { publishSample, recordSample } from "../helpers/recordSample";

/**
 * HUMAN STEP, run by hand only: `pnpm record:sample` with YOUCAM_API_KEY set. Never part of pnpm test, the live suites
 * or CI. It records the sample face's results ONCE, through the site's own route handlers (upload, skin-type, render:
 * the same code a visitor's tap runs, with its session, limiter and credit floor), so the Try page can show them for
 * the sample face without any YouCam call. It spends real units: one skin type read (10) and one render (1) for each
 * featured bottle at each tone. recordSample (tests/helpers/recordSample.ts, tested offline in
 * tests/unit/recordSample.test.ts) reads the live balance before every paid call and stops unless the rest of the run
 * still leaves FLOOR, and publishes nothing unless every task and download succeeded. The renders go to
 * public/sample/renders/ and the manifest to src/data/sample.json. The key, file ids, task ids and result URLs are never
 * printed or written: only counts, unit balances and error codes are.
 */
const FLOOR = 600;

/** The date in Atlanta, where the builder records, as YYYY-MM-DD. */
const recordedOn = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

test("record the sample face's skin type read and every featured render", { timeout: 1_800_000 }, async () => {
  const key = process.env.YOUCAM_API_KEY ?? "";
  expect(key.length, "YOUCAM_API_KEY is unset; this recorder fails, never skips").toBeGreaterThanOrEqual(16);
  const yc = createYouCam({ key });
  // Production's own route deps, with a throwaway session secret, the recording floor in place of CREDIT_FLOOR, and a
  // balance cache that never serves a cached value, so each route also checks the floor against a fresh read.
  const deps: RouteDeps = {
    env: { youcamKey: key, sessionSecret: randomBytes(32).toString("hex"), creditFloor: FLOOR, scanEnabled: false, toneEnabled: false },
    youcam: (k) => createYouCam({ key: k }),
    limiter: createLimiter(),
    catalogue: CATALOGUE,
    labels: LABELS,
    balance: createBalanceCache(0),
    now: () => Date.now(),
  };
  const rec = await recordSample({
    deps: () => deps,
    balance: () => yc.balance(),
    download: async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`render download answered ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    face: new Uint8Array(readFileSync("public/sample/face.jpg")),
    bottles: CATALOGUE,
    tones: TONES.map((t) => t.lStar),
    floor: FLOOR,
    recordedOn,
    log: (line) => console.log(line),
  });
  publishSample({ publicDir: "public", manifestPath: "src/data/sample.json", rec });
  expect(rec.manifest.renders).toHaveLength(CATALOGUE.length * TONES.length);
});

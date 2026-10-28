import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";

// Producer/consumer contract. The deploy scripts' own release check (scripts/deploy_checks.py) runs against this
// build, so a change to what /evidence renders (src/ui/GateTable.tsx) or to what the checker reads fails here,
// before a deploy reads it as a bad release. Desktop only (playwright.config.ts): the checker sends no viewport.
test("the deploy release check passes against this build, keyless", ({ baseURL }) => {
  test.setTimeout(90_000);
  const sha = process.env.NEXT_PUBLIC_RELEASE_SHA || "dev"; // the cf-release this build was made with (smoke.spec.ts)
  const r = spawnSync("python3", ["-I", "scripts/deploy_checks.py", "release", baseURL!, sha, "--require-no-youcam"], {
    encoding: "utf8",
    env: { ...process.env, RELEASE_ATTEMPTS: "1" },
    timeout: 75_000,
  });
  expect(r.error, String(r.error)).toBeUndefined();
  expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
  expect(r.stdout).toContain(`release ${sha} ok: html, health (youcam=false, session=true, node=22.`);
  expect(r.stdout).toContain("), evidence, gates");
});

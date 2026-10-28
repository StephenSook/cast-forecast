import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { walk } from "../helpers/copyGuard";

// Fix round 1 item 7: pnpm test:live must spend 0 units, so the paid task check lives in its own folder and config.
const includeOf = (file: string) => {
  const m = /include:\s*(\[[^\]]*\])/.exec(readFileSync(file, "utf8"));
  if (!m) throw new Error(`no include in ${file}`);
  return JSON.parse(m[1]) as string[];
};
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

test("each suite has its own include set and script", () => {
  expect(includeOf("vitest.config.ts")).toEqual(["tests/unit/**/*.test.ts", "tests/ui/**/*.test.tsx"]);
  expect(includeOf("vitest.live.config.ts")).toEqual(["tests/live/**/*.test.ts"]);
  expect(includeOf("vitest.live-task.config.ts")).toEqual(["tests/live-task/**/*.test.ts"]);
  expect(pkg.scripts["test:live"]).toBe("vitest run --config vitest.live.config.ts");
  expect(pkg.scripts["test:live:task"]).toBe("vitest run --config vitest.live-task.config.ts");
});
test("nothing under tests/live starts a task; the one paid check is under tests/live-task", () => {
  const free = walk("tests/live", [".ts"]);
  const paid = walk("tests/live-task", [".ts"]);
  expect(free.length).toBeGreaterThanOrEqual(1);
  expect(paid).toEqual(["tests/live-task/task-id.live.test.ts"]);
  for (const f of free) expect(readFileSync(f, "utf8"), f).not.toMatch(/\.run\(|\.poll\(/);
  expect(readFileSync(paid[0], "utf8").match(/\.run\(/g)).toHaveLength(1);
});

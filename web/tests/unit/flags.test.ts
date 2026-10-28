import { expect, test } from "vitest";
import { scanEnabled } from "@/lib/flags";
import { testEntry } from "../helpers/entries";
import { testEnv } from "../helpers/env";

test("scan needs a measured bottle and the env flag together", () => {
  expect(scanEnabled([], testEnv({ scanEnabled: true }))).toBe(false);
  expect(scanEnabled([testEntry()], testEnv({ scanEnabled: false }))).toBe(false);
  expect(scanEnabled([testEntry()], testEnv({ scanEnabled: true }))).toBe(true);
});

import { expect, test } from "vitest";
import { readServerEnv } from "@/server/env";

test("empty key is null", () => expect(readServerEnv({ YOUCAM_API_KEY: "" }).youcamKey).toBeNull());
test("secret under 32 chars is null; 32 is kept", () => {
  expect(readServerEnv({ SESSION_SECRET: "x".repeat(31) }).sessionSecret).toBeNull();
  expect(readServerEnv({ SESSION_SECRET: "x".repeat(32) }).sessionSecret).toBe("x".repeat(32));
});
test.each([[undefined, 100], ["250", 250], ["0", 0], ["-1", 100], ["1.5", 100], ["abc", 100]])("CREDIT_FLOOR %s gives %i", (v, want) =>
  expect(readServerEnv({ CREDIT_FLOOR: v }).creditFloor).toBe(want));
test.each([["1", true], ["true", false], [undefined, false]])("SCAN_ENABLED %s gives %s", (v, want) =>
  expect(readServerEnv({ SCAN_ENABLED: v }).scanEnabled).toBe(want));

// Beyond the brief.
test("an empty env is unconfigured with the default floor", () =>
  expect(readServerEnv({})).toEqual({ youcamKey: null, sessionSecret: null, creditFloor: 100, scanEnabled: false }));
test("a set key is kept as given", () => expect(readServerEnv({ YOUCAM_API_KEY: "k-1" }).youcamKey).toBe("k-1"));
test.each([["", 100], [" 5", 100], ["1e3", 100], ["0x10", 100], ["99999999999999999999", 100], ["007", 7]])(
  "CREDIT_FLOOR %j gives %i", (v, want) => expect(readServerEnv({ CREDIT_FLOOR: v }).creditFloor).toBe(want));

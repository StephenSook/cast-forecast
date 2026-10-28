import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { createYouCam } from "@/server/youcam";

// Spends 0 units: a file registration and its presigned PUT are free. Run by hand with YOUCAM_API_KEY set.
test("presigned upload works from Node fetch and costs 0 units", async () => {
  const key = process.env.YOUCAM_API_KEY ?? "";
  expect(key.length, "YOUCAM_API_KEY is unset; this test fails, never skips").toBeGreaterThanOrEqual(16);
  const yc = createYouCam({ key });
  const before = await yc.balance();
  const fileId = await yc.upload(readFileSync("tests/fixtures/plain-640x480.jpg"), "plain-640x480.jpg");
  expect(fileId).toMatch(/\S/);
  expect(await yc.balance()).toBe(before);
});

import { type Page, expect, test } from "@playwright/test";

// The Try page's layout once a render shows, driven by the sample face (recorded renders, so no paid route is called).
type Box = { x: number; y: number; width: number; height: number };

/** Loads the sample face and picks a chip; returns the page's scroll position just before the pick. */
async function sampleResult(page: Page): Promise<number> {
  await page.goto("/");
  // Retried until hydration has attached the click handler.
  await expect(async () => {
    await page.getByRole("button", { name: "Use a sample face" }).click();
    await expect(page.getByRole("img", { name: "The sample face" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await page.getByRole("button", { name: "Skin L* 55" }).click();
  const chip = page.locator("main button[aria-pressed]", { hasText: "Cetaphil" });
  await chip.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await chip.click();
  await expect(page.getByTestId("result-panel")).toBeVisible();
  await expect(page.getByTestId("before-after")).toBeVisible();
  return before;
}

const box = async (page: Page, testId: string): Promise<Box> => (await page.getByTestId(testId).boundingBox()) as Box;
const inViewport = (b: Box, vw: number, vh: number) => b.x >= 0 && b.y >= 0 && b.x + b.width <= vw && b.y + b.height <= vh;

test("desktop: the result sits beside the frame and both are on screen without scrolling", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop layout only");
  const before = await sampleResult(page);
  const { width: vw, height: vh } = page.viewportSize() as { width: number; height: number };
  const frame = await box(page, "capture-frame");
  const result = await box(page, "result");
  expect(result.x).toBeGreaterThanOrEqual(frame.x + frame.width); // to the right of the face, not under it
  expect(inViewport(frame, vw, vh), JSON.stringify(frame)).toBe(true);
  expect(inViewport(result, vw, vh), JSON.stringify(result)).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(before); // the render needed no scroll to be seen
  // The big number fits its column.
  expect(await page.getByTestId("result").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

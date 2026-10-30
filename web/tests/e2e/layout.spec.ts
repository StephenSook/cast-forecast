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

test("lg width, tall window: the frame stays in view (sticky) while the page scrolls down to the result", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop layout only");
  await page.setViewportSize({ width: 1100, height: 900 });
  const before = await sampleResult(page);
  // The result is under the controls here, so the page scrolls to it ...
  await expect(async () => {
    const result = await box(page, "result");
    expect(result.y + result.height).toBeLessThanOrEqual(900);
  }).toPass({ timeout: 5_000 });
  // Wait for the smooth scroll to settle: the same position on two reads 300 ms apart.
  await expect(async () => {
    const a = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBe(a);
  }).toPass({ timeout: 5_000 });
  expect(inViewport(await box(page, "capture-frame"), 1100, 900)).toBe(true);
  // Read on down to the end of the page, past where the frame would leave the screen if it scrolled with the page (its
  // top would be at about -110 px), and the face is still fully in view: held 5rem from the top, or let go just enough
  // to stay inside the grid near its end.
  const end = await page.evaluate(() => (document.scrollingElement as Element).scrollHeight - window.innerHeight);
  expect(end).toBeGreaterThan(350);
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), end);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(end);
  const card = (await page.getByTestId("capture-frame").evaluate((el) => (el.parentElement as HTMLElement).getBoundingClientRect().top)) as number;
  expect(card).toBeGreaterThanOrEqual(0);
  expect(card).toBeLessThanOrEqual(80);
  expect(inViewport(await box(page, "capture-frame"), 1100, 900)).toBe(true);
});

test("phone: after a render the result is scrolled into view", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone layout only");
  const before = await sampleResult(page);
  const vh = (page.viewportSize() as { height: number }).height;
  await expect(async () => {
    const result = await box(page, "result");
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.y + result.height).toBeLessThanOrEqual(vh);
  }).toPass({ timeout: 5_000 });
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before); // the page moved to the result
});

test("phone: with the frame scrolled to the top, the nav does not cover the Before and After labels", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone layout only");
  await sampleResult(page);
  await page.getByTestId("capture-frame").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 8));
  await expect.poll(() => page.getByTestId("capture-frame").evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(8);
  const pills = await page.locator("header a").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as Box));
  expect(pills.length).toBeGreaterThanOrEqual(2);
  for (const id of ["before-label", "after-label"]) {
    const label = await box(page, id);
    for (const p of pills) {
      const overlap = label.x < p.x + p.width && p.x < label.x + label.width && label.y < p.y + p.height && p.y < label.y + label.height;
      expect(overlap, `${id} under a nav pill`).toBe(false);
    }
  }
});

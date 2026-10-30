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

/** Waits for any smooth scroll to finish: the same position on two reads 300 ms apart. */
async function settled(page: Page): Promise<void> {
  await expect(async () => {
    const a = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBe(a);
  }).toPass({ timeout: 5_000 });
}
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
  await sampleResult(page);
  // The result is under the controls here, so the page scrolls to it ...
  await expect(async () => {
    const result = await box(page, "result");
    expect(result.y + result.height).toBeLessThanOrEqual(900);
  }).toPass({ timeout: 5_000 });
  await settled(page);
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

/** On a phone: the face (top of the frame) just under the nav band, and the big number on screen right below it. */
async function faceAndNumberTogether(page: Page): Promise<void> {
  const vh = (page.viewportSize() as { height: number }).height;
  await settled(page);
  const nav = (await page.getByTestId("site-nav").boundingBox()) as Box;
  const slot = (await page.getByTestId("frame-slot").boundingBox()) as Box;
  const word = (await page.getByTestId("result-word").boundingBox()) as Box;
  const picture = await box(page, "capture-frame");
  expect(slot.y, "the frame's top sits just under the nav").toBeGreaterThanOrEqual(nav.y + nav.height - 1);
  expect(slot.y).toBeLessThanOrEqual(nav.y + nav.height + 24);
  expect(word.y, "the number is right under the picture").toBeGreaterThan(picture.y + picture.height);
  expect(word.y + word.height, "and on screen").toBeLessThanOrEqual(vh);
}

test("phone: after a render the face and the number show together, the number right under the picture", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone layout only");
  const before = await sampleResult(page);
  // The result sits in the frame card, between the picture's label and the photo buttons.
  const note = await box(page, "result-note");
  const result = await box(page, "result");
  const takeSelfie = (await page.getByRole("button", { name: /Take a selfie/ }).boundingBox()) as Box;
  expect(result.y).toBeGreaterThan(note.y + note.height - 1);
  expect(result.y + result.height).toBeLessThan(takeSelfie.y);
  await faceAndNumberTogether(page);
  // The pick was made down at the chips; the page moved back up to the face.
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(before);
});

test("phone: a second render is shown with the face too", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone layout only");
  await sampleResult(page);
  await settled(page);
  // Back up to the chips and pick another: the old result goes while the new one loads, so the page shortens under the
  // shopper and the browser can clamp the scroll. That is not the shopper scrolling, so the new result is still shown.
  await page.locator("main button[aria-pressed]", { hasText: "Babo" }).click();
  await expect(page.getByTestId("result")).toContainText("Babo");
  await faceAndNumberTogether(page);
});

test("phone: the nav sits on a band that covers what scrolls under it; from md it floats as before", async ({ page }, info) => {
  await page.goto("/");
  const nav = page.getByTestId("site-nav");
  const style = await nav.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, top: el.getBoundingClientRect().top, left: el.getBoundingClientRect().left, width: el.getBoundingClientRect().width };
  });
  const vw = (page.viewportSize() as { width: number }).width;
  if (info.project.name === "phone") {
    expect(style.bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.top).toBe(0);
    expect(style.left).toBe(0);
    expect(Math.round(style.width)).toBe(vw);
    // Scrolled into the controls, the Suggest my tone button slides under the band, not between the pills.
    const suggest = page.getByRole("button", { name: "Suggest my tone" });
    await suggest.evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 30, behavior: "instant" }));
    const b = (await suggest.boundingBox()) as Box;
    expect(b.y).toBeLessThan(40); // it really is under the nav now
    const hit = await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('[data-testid="site-nav"]')), [b.x + 20, b.y + b.height / 2]);
    expect(hit, "the band, not the page, is on top where they overlap").toBe(true);
  } else {
    expect(style.bg).toBe("rgba(0, 0, 0, 0)");
    expect(Math.round(style.top)).toBe(12);
    expect(Math.round(style.left)).toBe(12);
  }
});

test("phone: with the frame scrolled to the top, the nav does not cover the Before and After labels", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone layout only");
  await sampleResult(page);
  await settled(page); // the smooth scroll to the result has finished, so it cannot move the page after ours
  await page
    .getByTestId("capture-frame")
    .evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 8, behavior: "instant" }));
  await expect.poll(() => page.getByTestId("capture-frame").evaluate((el) => Math.abs(el.getBoundingClientRect().top - 8) <= 3)).toBe(true);
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

// A slow live render, stubbed in the browser (the e2e server has no key; no request leaves the page): while it is in
// flight the shopper scrolls with Space on a focused link, and when it lands the page stays where they put it.
test("lg width: a slow render does not pull the page back after the shopper scrolled with Space on a link", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop keyboard only");
  await page.setViewportSize({ width: 1100, height: 700 });
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/upload", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fileId: "stub-file" }) }));
  await page.route("**/api/render", async (r) => {
    await held;
    const { bottleId } = JSON.parse(r.request().postData() ?? "{}");
    await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ imageUrl: "https://render.test/r.jpg", bottleId, colorIntensity: 8, predictedBlend: 0.0275, expiresAt: Date.now() + 6_000_000 }) });
  });
  await page.route("https://render.test/**", (r) => r.fulfill({ status: 200, contentType: "image/jpeg", path: "tests/fixtures/plain-640x480.jpg" }));
  await page.goto("/");
  await expect(async () => {
    await page.getByTestId("upload-input").setInputFiles("tests/fixtures/plain-640x480.jpg");
    await expect(page.getByTestId("selfie-preview")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await page.getByRole("button", { name: "Skin L* 55" }).click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.locator("main button[aria-pressed]", { hasText: "Cetaphil" }).click();
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: /Rendering|Sending/ })).toBeVisible();
  // Space on a focused link scrolls the page; it does not follow the link.
  await page.getByRole("link", { name: "Evidence" }).first().focus();
  const before = await page.evaluate(() => window.scrollY);
  await page.keyboard.press(" ");
  await settled(page);
  const after = await page.evaluate(() => window.scrollY);
  expect(after).toBeGreaterThan(before);
  expect(new URL(page.url()).pathname).toBe("/");
  release();
  await expect(page.getByTestId("result-panel")).toBeAttached();
  await settled(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(after);
});

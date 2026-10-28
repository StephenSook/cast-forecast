import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Console messages of type "error", collected for every test. Alert queries elsewhere are scoped to <main> because
// Next's route announcer is a second role="alert".
let consoleErrors: string[] = [];
test.beforeEach(({ page }) => {
  consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
});

for (const p of ["/", "/compare", "/evidence"]) {
  test(`${p} renders, passes axe, no console errors, no sideways scroll`, async ({ page }) => {
    expect((await page.goto(p))!.status()).toBe(200);
    expect(await page.getByRole("heading", { level: 1 }).count()).toBe(1);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    expect(consoleErrors).toEqual([]);
  });
}

test("/ stays within 20 words on an empty catalogue", async ({ page }) => {         // expected 18
  await page.goto("/");
  expect((await page.locator("main").innerText()).split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(20);
});

test("hand line and h1 do not overlap", async ({ page }) => {
  for (const p of ["/", "/compare", "/evidence"]) {
    await page.goto(p);
    const hand = (await page.locator("main .hand").first().boundingBox())!;
    const h1 = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    expect(h1.y - (hand.y + hand.height), p).toBeGreaterThanOrEqual(4);
  }
});

test("evidence lists K1b as PASS and prints the curl", async ({ page }) => {
  await page.goto("/evidence");
  await expect(page.getByRole("row", { name: /K1b/ })).toContainText("PASS");
  await expect(page.locator("code", { hasText: "/api/gates" })).toHaveText(/^curl -s https?:\/\/\S+\/api\/gates$/);
});

test("evidence step cards never clip at 390", async ({ page }) => {
  await page.goto("/evidence");
  for (const li of await page.locator("ol > li").all()) expect(await li.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
});

test("evidence renders with no key", async ({ page }) => {                          // Review Focus 5
  expect((await page.goto("/evidence"))!.status()).toBe(200);
  const r = await page.request.get("/api/credits");
  expect(r.status()).toBe(503);
  expect(await r.json()).toEqual({ error: { code: "not_configured", message: "Try-on is paused. Evidence is open." } });
});

test("/bottle/anything and /scan are 404 with an empty catalogue", async ({ page }) => {
  expect((await page.goto("/bottle/anything"))!.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Not here.");
  expect((await page.goto("/scan"))!.status()).toBe(404);
});

test("release meta is present", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[name="cf-release"]')).toHaveAttribute("content", process.env.NEXT_PUBLIC_RELEASE_SHA || "dev");
});

test("/api/gates recomputes the K1b plan", async ({ page }) => {
  const g = await (await page.request.get("/api/gates")).json();
  expect(g.k1b.inverseCheck).toHaveLength(3);
  expect(g.k1b.inverseCheck.every((c: { match: boolean }) => c.match)).toBe(true);
});

// Added for the empty catalogue and the phone path.
test("/compare shows the empty line, and every chart label renders at 12 px or more", async ({ page }) => {
  await page.goto("/compare");
  await expect(page.getByRole("main").getByText("No bottles measured yet.")).toBeVisible();
  await page.goto("/evidence");
  const sizes = await page.locator("[data-chart-label]").evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  expect(sizes.length).toBe(2);
  for (const s of sizes) expect(s).toBeGreaterThanOrEqual(12);
});

test("a phone can reach /compare from the header", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone nav only");
  await page.goto("/");
  await page.getByTestId("phone-compare").click();
  await expect(page).toHaveURL(/\/compare$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Compare");
});

import { readFileSync } from "node:fs";
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

// The search field's label names the one control that reaches the labels that are not chips, so, like the chip names,
// it is outside the budget; it is exactly "Find your sunscreen" and nothing else is. The sample face button is the one
// way to try the page without a selfie, so it is outside the budget too, and is exactly "Use a sample face".
test("/ stays within 20 words besides the bottle names, the search label and the sample face button", async ({ page }) => {
  await page.goto("/");
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  const chips = page.locator("main button[aria-pressed]");
  expect(await chips.count()).toBeGreaterThanOrEqual(5);
  const chipWords = (await chips.allInnerTexts()).reduce((n, t) => n + words(t), 0);
  const label = page.locator("main label", { hasText: "Find your sunscreen" });
  await expect(label).toHaveText("Find your sunscreen");
  const sample = page.locator("main button", { hasText: "sample" });
  await expect(sample).toHaveText("Use a sample face");
  const outside = words("Find your sunscreen") + words("Use a sample face");
  expect(words(await page.locator("main").innerText()) - chipWords - outside).toBeLessThanOrEqual(20);
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
  await expect(page.locator("code", { hasText: "/api/label-model" })).toHaveText(/^curl -s https?:\/\/\S+\/api\/label-model$/);
});

test("/api/label-model recomputes Gate 1's held-out error", async ({ request }) => {
  const res = await request.get("/api/label-model");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.heldOut.cells).toBe(65); expect(body.heldOut.maeL).toBeCloseTo(1.61, 2);
  expect(body.heldOut.benchmark.maeL).toBeCloseTo(2.35, 2);
});

// The agent card's curl, run as printed: at the URL it prints, which must be this page's own origin (Codex review: a
// fixed "/api/mcp" passed whatever host the card named), answering the shipped catalogue's number for that bottle and tone.
test("the predict_cast curl on /evidence runs against this server and answers the catalogue's number", async ({ page }) => {
  await page.goto("/evidence");
  const line = (await page.locator("code", { hasText: "/api/mcp" }).textContent())!;
  expect(line).toMatch(/^curl -s \S+ -H 'Content-Type: application\/json' -d '\{.*\}'$/);
  const url = /^curl -s (\S+) /.exec(line)![1];
  expect(url).toBe(`${new URL(page.url()).origin}/api/mcp`);
  const body = /-d '(.*)'$/.exec(line)![1];
  const res = await page.request.post(url, { data: body, headers: { "Content-Type": "application/json" } });
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("no-store");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  const { result } = await res.json();
  expect(result.isError).toBeUndefined();
  const args = JSON.parse(body).params.arguments;
  const catalogue = JSON.parse(readFileSync("src/data/bottles.json", "utf8"));
  const bottle = catalogue.bottles.find((b: { id: string }) => b.id === args.bottle_id);
  const tone = bottle.tones.find((t: { lStar: number }) => t.lStar === args.skin_lightness);
  expect(result.structuredContent.whitening).toEqual(tone.whitening);
});

test("/api/mcp is POST only, and /llms.txt prints the same curl", async ({ request }) => {
  const get = await request.get("/api/mcp");
  expect(get.status()).toBe(405);
  expect(get.headers()["allow"]).toBe("POST");
  const llms = await request.get("/llms.txt");
  expect(llms.status()).toBe(200);
  expect(llms.headers()["content-type"]).toBe("text/plain; charset=utf-8");
  const text = await llms.text();
  expect(text).toMatch(/^# Cast Forecast\n/);
  // Every curl names the origin llms.txt was served from.
  const origin = new URL(llms.url()).origin;
  const urls = [...text.matchAll(/^curl -s (\S+) /gm)].map((m) => m[1]);
  expect(urls.length).toBeGreaterThanOrEqual(5);
  for (const u of urls) expect(u).toBe(`${origin}/api/mcp`);
  expect(text).toMatch(/^curl -s \S+ -H 'Content-Type: application\/json' -d '.*predict_cast.*'$/m);
});

test("evidence step cards never clip at 390", async ({ page }) => {
  await page.goto("/evidence");
  const items = await page.locator("ol > li").all();
  expect(items).toHaveLength(6);
  for (const li of items) expect(await li.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
});

test("evidence renders with no key", async ({ page }) => {                          // Review Focus 5
  expect((await page.goto("/evidence"))!.status()).toBe(200);
  const r = await page.request.get("/api/credits");
  expect(r.status()).toBe(503);
  expect(await r.json()).toEqual({ error: { code: "not_configured", message: "Try-on is paused. Evidence is open." } });
});

test("/api/tone is 404 when the server does not set TONE_ENABLED", async ({ page }) => {
  const r = await page.request.post("/api/tone", { data: { fileId: "file-1" } });
  expect(r.status()).toBe(404);
  expect(await r.text()).toBe("");
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

// Added for the catalogue and the phone path.
test("/compare draws one bar per bottle, and every chart label renders at 12 px or more", async ({ page }) => {
  await page.goto("/compare");
  const bars = page.getByRole("list", { name: "Predicted whitening by bottle" });
  await expect(bars).toBeVisible();
  expect(await bars.getByRole("listitem").count()).toBeGreaterThanOrEqual(5);
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

test("every page and API route sends the security headers", async ({ request }) => {
  for (const path of ["/", "/evidence", "/api/health", "/api/label-model", "/llms.txt", "/art/grain.svg"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    const h = res.headers();
    expect(h["x-content-type-options"], path).toBe("nosniff");
    expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(h["x-frame-options"], path).toBe("DENY");
    expect(h["permissions-policy"], path).toBe("camera=(self), microphone=(), geolocation=()");
    expect(h["cross-origin-opener-policy"], path).toBe("same-origin");
  }
});

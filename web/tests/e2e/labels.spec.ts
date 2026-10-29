import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// A label only search reaches (not one of the eight chips), from the committed catalogue.
const FOUND = { id: "blue-lizard-sheer-sunscreen-3368f1cb", name: "Blue Lizard Sheer Sunscreen" };
const RESULT_URL = "https://out.example/render.jpg";

let consoleErrors: string[] = [];
test.beforeEach(({ page }) => {
  consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
});

// The e2e server has no YouCam key, so the try-on routes are answered here: the upload, the render (whose request
// is the thing under test) and the render image. Nothing reaches YouCam.
test("search, pick a label that is not a chip, and its render request goes out like a chip's", async ({ page }) => {
  const renders: unknown[] = [];
  await page.route("**/api/upload", (r) => r.fulfill({ json: { fileId: "file-e2e" } }));
  await page.route("**/api/render", (r) => {
    renders.push(r.request().postDataJSON());
    return r.fulfill({ json: { imageUrl: RESULT_URL, bottleId: FOUND.id, colorIntensity: 40, predictedBlend: 0.14, expiresAt: Date.now() + 6_000_000 } });
  });
  await page.route(RESULT_URL, (r) => r.fulfill({ contentType: "image/jpeg", body: readFileSync("tests/fixtures/plain-640x480.jpg") }));

  await page.goto("/");
  await page.getByTestId("upload-input").setInputFiles("tests/fixtures/plain-640x480.jpg");
  await expect(page.getByTestId("selfie-preview")).toBeVisible();
  await page.getByRole("button", { name: "Skin L* 55" }).click();
  const box = page.getByRole("combobox", { name: "Find your sunscreen" });
  await box.fill("blue lizard sheer");
  const option = page.getByRole("option", { name: new RegExp(FOUND.name) });
  await expect(option).toBeVisible();
  await box.press("ArrowDown");
  await box.press("Enter");

  await expect(page.getByRole("button", { name: FOUND.name })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(`${FOUND.name} on skin of L* 55. Predicted from the label; the picture is an approximation.`)).toBeVisible();
  expect(renders).toEqual([{ fileId: "file-e2e", bottleId: FOUND.id, tone: 55 }]);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test("the search list passes axe while it is open", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("upload-input").setInputFiles("tests/fixtures/plain-640x480.jpg");
  await page.getByRole("combobox", { name: "Find your sunscreen" }).fill("mineral");
  await expect(page.getByRole("option").first()).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
});

test("/api/labels answers full entries for a query and refuses a blank one", async ({ request }) => {
  const res = await request.get("/api/labels?q=blue%20lizard");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.total).toBeGreaterThanOrEqual(3);
  expect(body.bottles.map((b: { id: string }) => b.id)).toContain(FOUND.id);
  expect((await request.get("/api/labels?q=")).status()).toBe(400);
});

import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { FORBIDDEN } from "../bundle/scan";

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

test("/compare lists every label least cast first, searches, and changes tone", async ({ page }) => {
  await page.goto("/compare");
  const rows = page.getByRole("list", { name: "Predicted whitening by bottle" }).getByRole("listitem");
  await expect(rows).toHaveCount(25);
  await expect(page.getByText(/^Page 1 of \d+$/)).toBeVisible();
  await page.getByRole("searchbox", { name: "Find your sunscreen" }).fill("blue lizard");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/compare\?tone=55&q=blue\+lizard$/);
  const n = await rows.count();
  expect(n).toBeGreaterThanOrEqual(3);
  for (const t of await rows.allInnerTexts()) expect(t).toMatch(/Blue Lizard/);
  await page.getByRole("link", { name: "Skin L* 45" }).click();
  await expect(page).toHaveURL(/tone=45/);
  await expect(page.getByText(/^Predicted whitening on skin of L\* 45/)).toBeVisible();
  await rows.first().getByRole("link").click();
  await expect(page).toHaveURL(/\/bottle\/blue-lizard-/);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("a label that is not a chip has its own bottle page, on the tone asked for", async ({ page }) => {
  expect((await page.goto(`/bottle/${FOUND.id}?tone=45`))!.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(FOUND.name);
  await expect(page.getByText(/for skin of L\* 45\./)).toBeVisible();
  await expect(page.getByRole("link", { name: /Read the FDA label/ })).toHaveAttribute("href", /dailymed\.nlm\.nih\.gov.*setid=3368f1cb-/);
  await expect(page.getByRole("link", { name: "Try it on me" })).toHaveAttribute("href", `/?bottle=${FOUND.id}&tone=45`);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  // Its "Try it on me" opens the Try page with that label as a picked chip and the tone picked.
  await page.getByRole("link", { name: "Try it on me" }).click();
  await expect(page.getByRole("button", { name: FOUND.name })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Skin L* 45" })).toHaveAttribute("aria-pressed", "true");
});

// The bundle test scans prerendered pages; these are rendered per request, so they are scanned as served.
test("pages and answers rendered per request carry no key name, no Bearer, no YouCam host", async ({ request }) => {
  for (const path of ["/", "/compare", "/compare?q=mineral&page=2", `/bottle/${FOUND.id}`, "/evidence", "/api/labels?q=mineral"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    const text = await res.text();
    for (const needle of FORBIDDEN) expect(text.includes(needle), `${path} ${needle}`).toBe(false);
  }
});

test("the evidence page counts every label and names what is left out, from the data", async ({ page }) => {
  const data = JSON.parse(readFileSync("../data/bottles/fda_labels.json", "utf8")).counts;
  await page.goto("/evidence");
  await expect(page.getByText(`Bottles: ${data.kept}.`, { exact: false })).toBeVisible();
  await expect(page.getByText(`Not predicted: tinted (${data.tinted}), powders (${data.powder}), lip products (${data.lip}), and any render more than 1 L* off its prediction (${data.render_error}).`)).toBeVisible();
});

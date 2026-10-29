import { expect, test } from "@playwright/test";
import { type Fitzpatrick, SUGGESTED_TONE } from "@/lib/skinType";

// One real try-on on the deployed site, the way a judge does it: a selfie, the middle tone, a bottle, YouCam's render.
// Spends one unit. Run with playwright.live.config.ts, which requires BASE_URL and LIVE_SELFIE.
test("a selfie, a tone and a bottle come back as a real render with the tone's prediction", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("upload-input").setInputFiles(process.env.LIVE_SELFIE!);
  await expect(page.getByTestId("selfie-preview")).toBeVisible();
  await page.getByRole("button", { name: "Skin L* 55" }).click();
  const chip = page.locator("main button[aria-pressed]").filter({ hasText: /Neutrogena/ });
  await expect(chip).toBeEnabled();
  await chip.click();
  const image = page.getByTestId("result-image");
  await expect(image).toBeVisible({ timeout: 150_000 });
  expect(await image.getAttribute("src")).toMatch(/^https:\/\//);
  const block = page.getByTestId("result");
  await expect(block).toContainText(/Neutrogena Sheer Zinc on skin of L\* 55\. Predicted from the label; the picture is an approximation\./);
  await expect(block).toContainText(/^\+\d+\.\d L\*/);
  // The before/after split lines up when the render keeps the selfie's shape. YouCam resizes to multiples of 8
  // (a 697x1079 selfie came back 696x1080, 0.24% off), under 1 px in the frame; 1% would be visible.
  const aspect = (id: string) => page.getByTestId(id).evaluate((el: HTMLImageElement) => el.naturalWidth / el.naturalHeight);
  const [after, before] = [await aspect("result-image"), await aspect("before-image")];
  expect(Math.abs(after / before - 1)).toBeLessThan(0.01);
  const slider = page.getByRole("slider", { name: "Before and after" });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveValue("52");
  await page.screenshot({ path: test.info().outputPath("live-try-on.png"), fullPage: true });
});

// Spends 10 units: YouCam's Fitzpatrick type for the selfie, and the tone it preselects.
test("suggest my tone reads a Fitzpatrick type and preselects that type's tone", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("upload-input").setInputFiles(process.env.LIVE_SELFIE!);
  await expect(page.getByTestId("selfie-preview")).toBeVisible();
  await page.getByRole("button", { name: "Suggest my tone" }).click();
  const line = page.getByText(/^YouCam reads Fitzpatrick type (I|II|III|IV|V|VI)\./);
  await expect(line).toBeVisible({ timeout: 150_000 });
  const type = (await line.innerText()).match(/type (I|II|III|IV|V|VI)\./)![1] as Fitzpatrick;
  test.info().annotations.push({ type: "fitzpatrick", description: type });
  const tone = SUGGESTED_TONE[type];
  const pressed = page.getByRole("button", { name: tone === "deeper" ? "Deeper" : `Skin L* ${tone}` });
  await expect(pressed).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: test.info().outputPath("live-suggest.png"), fullPage: true });
});

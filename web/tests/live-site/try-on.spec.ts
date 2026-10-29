import { expect, test } from "@playwright/test";

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
  await page.screenshot({ path: test.info().outputPath("live-try-on.png"), fullPage: true });
});

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const FIX = "tests/fixtures/";
// Every request URL ending in /api/upload. The selfie may leave the browser only through that route.
const uploads: string[] = [];
// Alerts are looked up inside <main>: Next's route announcer is a second role="alert" (in an open shadow root
// on <body>), which a page-wide getByRole("alert") also matches, failing strict mode.

test.beforeEach(({ page }) => { uploads.length = 0; page.on("request", (r) => { if (r.url().endsWith("/api/upload")) uploads.push(r.url()); }); });
test("rotated EXIF photo is upright, 809x1079, and metadata-free", async ({ page }) => {    // Review Focus 1
  expect(readFileSync(FIX + "exif-rot6-4032x3024.jpg").includes(Buffer.from("Exif"))).toBe(true); // precondition
  await page.goto("/"); await page.getByTestId("upload-input").setInputFiles(FIX + "exif-rot6-4032x3024.jpg");
  const r = await page.getByTestId("selfie-preview").evaluate(async (img: HTMLImageElement) => {
    const b = await (await fetch(img.src)).blob(); const u = new Uint8Array(await b.arrayBuffer()); const bm = await createImageBitmap(b);
    return { w: bm.width, h: bm.height, type: b.type, exif: new TextDecoder("latin1").decode(u).includes("Exif\u0000\u0000") };
  });
  expect(r).toEqual({ w: 809, h: 1079, type: "image/jpeg", exif: false });
});
test("an undecodable file shows the JPEG line", async ({ page }) => {                      // Review Focus 2
  await page.goto("/"); await page.getByTestId("upload-input").setInputFiles(FIX + "not-an-image.heic");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Use a JPEG or PNG photo.");
  expect(uploads).toEqual([]);
});
test("a tall narrow photo shows the too small line", async ({ page }) => {
  await page.goto("/"); await page.getByTestId("upload-input").setInputFiles(FIX + "tall-1080x4000.jpg");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("That photo is too small.");
});
test("nothing is uploaded until a bottle is tapped", async ({ page }) => {
  await page.goto("/"); await page.getByTestId("upload-input").setInputFiles(FIX + "plain-640x480.jpg");
  await expect(page.getByTestId("selfie-preview")).toBeVisible();
  await expect(page.locator("main button[aria-pressed]").first()).toBeVisible();
  expect(uploads).toEqual([]);
});
// The inputs are visually hidden rather than display:none, so a programmatic click opens the picker on phones too.
test("each button opens its own file picker", async ({ page }) => {
  await page.goto("/");
  for (const [name, id] of [[/Take a selfie/, "camera-input"], ["Upload", "upload-input"]] as const) {
    // Retried until hydration has attached the click handler.
    await expect(async () => {
      const chooser = page.waitForEvent("filechooser", { timeout: 1_000 });
      await page.getByRole("button", { name }).click();
      const fc = await chooser;
      expect(await fc.element().getAttribute("data-testid")).toBe(id);
      expect(fc.isMultiple()).toBe(false);
    }).toPass({ timeout: 10_000 });
  }
  const camera = page.getByTestId("camera-input");
  await expect(camera).toHaveAttribute("capture", "user");
  expect(await camera.evaluate((el) => getComputedStyle(el).display)).not.toBe("none");
  expect(uploads).toEqual([]);
});

import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The sample face's results are recordings (src/data/sample.json), so using it may never reach a paid route. Every
// request is watched, not only the ones the page is expected to make.
const sample = JSON.parse(readFileSync("src/data/sample.json", "utf8")) as {
  skinType: { fitzpatrick: string; recordedOn: string };
  renders: { bottleId: string; tone: number; src: string; recordedOn: string }[];
};
const { bottles } = JSON.parse(readFileSync("src/data/bottles.json", "utf8")) as { bottles: { id: string; name: string }[] };
const SUGGESTED: Record<string, number> = { I: 65, II: 65, III: 60, IV: 55, V: 45 };
const PAID = /\/api\/(upload|render|skin-type|tone)(\?|$)/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

const paid: string[] = [];
test.beforeEach(({ page }) => {
  paid.length = 0;
  page.on("request", (r) => { if (PAID.test(new URL(r.url()).pathname)) paid.push(r.url()); });
});

async function useSample(page: import("@playwright/test").Page) {
  await page.goto("/");
  // Retried until hydration has attached the click handler.
  await expect(async () => {
    await page.getByRole("button", { name: "Use a sample face" }).click();
    await expect(page.getByRole("img", { name: "The sample face" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

test("the sample face suggests its recorded tone and plays a recorded render, labelled, with no paid request", async ({ page }) => {
  await useSample(page);
  await page.getByRole("button", { name: "Suggest my tone" }).click();
  await expect(page.getByText(`Recorded read (YouCam Fitzpatrick Skin Type, ${short(sample.skinType.recordedOn)})`)).toBeVisible();
  const tone = SUGGESTED[sample.skinType.fitzpatrick];
  expect(tone, "the recorded type suggests a tone with a prediction").toBeDefined();
  await expect(page.getByRole("button", { name: `Skin L* ${tone}` })).toHaveAttribute("aria-pressed", "true");

  for (const b of bottles.slice(0, 2)) {
    const rec = sample.renders.find((r) => r.bottleId === b.id && r.tone === tone);
    expect(rec, `${b.id} at ${tone} is recorded`).toBeDefined();
    await page.getByRole("button", { name: b.name, exact: true }).click();
    const img = page.getByTestId("result-image");
    await expect(img).toHaveAttribute("src", rec!.src);
    await expect(page.getByTestId("result-note")).toHaveText(`Recorded render (YouCam Makeup VTO, ${short(rec!.recordedOn)})`);
    expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await expect(page.getByTestId("before-after")).toBeVisible();
  }
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  expect(paid).toEqual([]);
});

test("a label found by search on the sample face asks for your own selfie and sends nothing", async ({ page }) => {
  await useSample(page);
  await page.getByRole("button", { name: "Skin L* 55" }).click();
  // No featured bottle is a Thinkbaby label, so every option here is a label with no recording.
  expect(bottles.filter((b) => /thinkbaby/i.test(b.name))).toEqual([]);
  await page.getByRole("combobox", { name: "Find your sunscreen" }).fill("thinkbaby");
  await page.getByRole("option").first().click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Live render needs your own selfie.");
  await expect(page.getByTestId("result-image")).toHaveCount(0);
  expect(paid).toEqual([]);
});

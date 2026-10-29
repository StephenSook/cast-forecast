// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { expectNoAxeViolations } from "../axe";

// 30 bottles: whitening 30 - i on L* 45 and i on every other tone, so the order flips between those tones.
vi.mock("@/server/labels", async () => {
  const { TEST_TONES, testEntry } = await import("../helpers/entries");
  const w = (value: number) => ({ value, low: value - 1, high: value + 1, unit: "L*" });
  const entry = (i: number) =>
    testEntry({
      id: `test-${i}`,
      name: `Test entry ${String(i).padStart(2, "0")}`,
      brand: i === 7 ? "Lonely brand" : "Test brand",
      whitening: w(i),
      tones: TEST_TONES.map((t) => ({ lStar: t.lStar, whitening: w(t.lStar === 45 ? 30 - i : i), render: null })),
    });
  return { LABELS: Array.from({ length: 30 }, (_, i) => entry(i + 1)) };
});

import Compare from "@/app/compare/page";

const page = async (sp: Record<string, string>) =>
  render(await Compare({ params: Promise.resolve({}), searchParams: Promise.resolve(sp) } as PageProps<"/compare">));
const rows = () => within(screen.getByRole("list", { name: "Predicted whitening by bottle" })).getAllByRole("listitem");

test("one unit draws the bars under the unit sentence, least cast first, 25 to a page", async () => {
  const { container } = await page({});
  expect(screen.getByText(/^Predicted whitening on skin of L\* 55, in L\*, from 30 FDA labels\. Least cast first\.$/)).toBeInTheDocument();
  expect(rows()).toHaveLength(25);
  expect(rows()[0]).toHaveTextContent("Test entry 01");
  expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/compare?tone=55&page=2");
  await expectNoAxeViolations(container);
});

test("the tone reorders the list, and each name links to its bottle page", async () => {
  await page({ tone: "45" });
  expect(rows()[0]).toHaveTextContent("Test entry 30");
  expect(within(rows()[0]).getByRole("link", { name: "Test entry 30" })).toHaveAttribute("href", "/bottle/test-30");
  expect(screen.getByRole("link", { name: "Skin L* 45" })).toHaveAttribute("aria-current", "true");
});

test("search narrows the list and keeps the tone in every link", async () => {
  await page({ tone: "60", q: "entry 2" });
  expect(rows().map((r) => r.textContent?.slice(0, 13))).toEqual(["Test entry 20", "Test entry 21", "Test entry 22", "Test entry 23", "Test entry 24", "Test entry 25", "Test entry 26", "Test entry 27", "Test entry 28", "Test entry 29"]);
  expect(screen.getByRole("link", { name: "Skin L* 45" })).toHaveAttribute("href", "/compare?tone=45&q=entry+2");
  expect(screen.queryByText(/Page \d of/)).toBeNull();
});

test("a name that does not lead with its brand gets the brand once", async () => {
  await page({ q: "lonely" });
  expect(rows()).toHaveLength(1);
  expect(rows()[0]).toHaveTextContent("Test entry 07, Lonely brand");
});

test("no match says so; a page past the end shows the last page; an unknown tone is L* 55", async () => {
  await page({ q: "zzz" });
  expect(screen.getByText("No bottle by that name.")).toBeInTheDocument();
  cleanup();
  await page({ page: "9", tone: "40" });
  expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  expect(rows()).toHaveLength(5);
  expect(screen.getByRole("link", { name: "Skin L* 55" })).toHaveAttribute("aria-current", "true");
});

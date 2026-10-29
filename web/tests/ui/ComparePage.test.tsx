// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

vi.mock("@/server/labels", async () => {
  const { TEST_TONES, testEntry } = await import("../helpers/entries");
  const dE = { value: 1, low: 0, high: 2, unit: "dE" };
  return {
    LABELS: [testEntry(), testEntry({ id: "test-b", whitening: dE, tones: TEST_TONES.map((t) => ({ lStar: t.lStar, whitening: dE, render: null })) })],
  };
});

import Compare from "@/app/compare/page";

// Mixed units cannot share one axis: the page shows the card, no chart, and no unit sentence above it.
test("mixed units show the Data unavailable card and no unit sentence", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(await Compare({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as PageProps<"/compare">));
  expect(screen.getByText(/Data unavailable: predicted whitening by bottle/)).toBeInTheDocument();
  expect(screen.queryByText(/Predicted whitening on skin of L\* 55, in/)).toBeNull();
  expect(screen.queryByRole("list", { name: "Predicted whitening by bottle" })).toBeNull();
});

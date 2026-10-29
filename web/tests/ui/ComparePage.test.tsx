// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { testEntry } from "../helpers/entries";

vi.mock("@/lib/catalogue", async (orig) => ({
  ...(await orig<typeof import("@/lib/catalogue")>()),
  CATALOGUE: [testEntry(), testEntry({ id: "test-b", whitening: { value: 1, low: 0, high: 2, unit: "dE" } })],
}));

import Compare from "@/app/compare/page";

// Mixed units cannot share one axis: the page shows the card, no chart, and no unit sentence above it.
test("mixed units show the Data unavailable card and no unit sentence", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(<Compare />);
  expect(screen.getByText(/Data unavailable: predicted whitening by bottle/)).toBeInTheDocument();
  expect(screen.queryByText(/Predicted whitening on skin of L\* 55, in/)).toBeNull();
  expect(screen.queryByRole("list", { name: "Predicted whitening by bottle" })).toBeNull();
});

// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { testEntry } from "../helpers/entries";

vi.mock("@/lib/catalogue", async (orig) => ({ ...(await orig<typeof import("@/lib/catalogue")>()), CATALOGUE: [testEntry()] }));

import Compare from "@/app/compare/page";

test("one unit draws the bars under the unit sentence", () => {
  render(<Compare />);
  expect(screen.getByText("Measured whitening, in L*.")).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Measured whitening by bottle" })).toBeInTheDocument();
});

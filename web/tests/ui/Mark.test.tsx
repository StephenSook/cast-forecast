// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { Mark } from "@/ui/Mark";

// The mark is an ink square, so on the ink footer it vanished. A paper ring keeps the square visible there.
test("the ink square has a paper ring so it shows on ink", () => {
  const { container } = render(<Mark />);
  const square = container.querySelector("rect")!;
  expect(square.getAttribute("fill")).toBe("var(--ink)");
  expect(square.getAttribute("stroke")).toBe("var(--paper)");
  expect(Number(square.getAttribute("stroke-width"))).toBeGreaterThanOrEqual(2);
});

test("stays decorative", () => {
  const { container } = render(<Mark />);
  expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});

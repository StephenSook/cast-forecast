// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { StatTile } from "@/ui/StatTile";
import { expectNoAxeViolations } from "../axe";

test("shows the value in display type above its label", () => {
  render(<StatTile value="0.982" label="isotonic fit R squared" />);
  expect(screen.getByText("0.982")).toHaveClass("display");
  expect(screen.getByText("isotonic fit R squared")).toHaveClass("font-bold");
});

test("each tone is a light fill with ink text, never green or red", () => {
  for (const tone of ["paper", "amber", "aqua", "sand"] as const) {
    const { container, unmount } = render(<StatTile value="1" label="x" tone={tone} />);
    const tile = container.firstElementChild;
    expect(tile).toHaveClass(`bg-${tone}`, "text-ink");
    expect(tile?.className).not.toMatch(/\bbg-(green|red)/);
    unmount();
  }
});

test("defaults to paper", () => {
  const { container } = render(<StatTile value="1" label="x" />);
  expect(container.firstElementChild).toHaveClass("bg-paper");
});

test("has no axe violations", async () => {
  const { container } = render(<StatTile value="0.982" label="isotonic fit R squared" />);
  await expectNoAxeViolations(container);
});

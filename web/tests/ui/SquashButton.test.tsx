// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { SquashButton } from "@/ui/SquashButton";
import { expectNoAxeViolations } from "../axe";

test("renders a link when href is given", () => {
  render(<SquashButton href="/compare">Compare</SquashButton>);
  expect(screen.getByRole("link", { name: /Compare/ })).toHaveAttribute("href", "/compare");
});

test("renders a button with type button by default", () => {
  render(<SquashButton>Go</SquashButton>);
  expect(screen.getByRole("button", { name: /Go/ })).toHaveAttribute("type", "button");
});

test("honours disabled", () => {
  render(<SquashButton disabled>Go</SquashButton>);
  expect(screen.getByRole("button", { name: /Go/ })).toBeDisabled();
});

test("hides the icon from assistive tech, so the name is the label alone", () => {
  const { container } = render(<SquashButton>Go</SquashButton>);
  expect(container.querySelector(".btn-icon")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByRole("button")).toHaveAccessibleName("Go");
});

test("passes submit type, click handler and colors through", async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  render(
    <SquashButton type="submit" onClick={onClick} bg="var(--paper)" fg="var(--ink)" accent="var(--aqua)">
      Go
    </SquashButton>,
  );
  const button = screen.getByRole("button", { name: /Go/ });
  expect(button).toHaveAttribute("type", "submit");
  expect(button.style.getPropertyValue("--btn-bg")).toBe("var(--paper)");
  expect(button.style.getPropertyValue("--btn-fg")).toBe("var(--ink)");
  expect(button.style.getPropertyValue("--btn-accent")).toBe("var(--aqua)");
  await user.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});

test("has no axe violations", async () => {
  const { container } = render(
    <div>
      <SquashButton type="button">Go</SquashButton>
      <SquashButton href="/compare">Compare</SquashButton>
      <SquashButton disabled>Go later</SquashButton>
    </div>,
  );
  await expectNoAxeViolations(container);
});

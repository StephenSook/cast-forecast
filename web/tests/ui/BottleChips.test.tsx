// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { BottleChips } from "@/ui/BottleChips";
import { expectNoAxeViolations } from "../axe";

const chips = [{ id: "test-a", name: "Test entry A" }, { id: "test-b", name: "Test entry B" }];
test("marks the selected chip with aria-pressed", () => {
  render(<BottleChips bottles={chips} selectedId="test-b" disabled={false} onPick={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Test entry B" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Test entry A" })).toHaveAttribute("aria-pressed", "false");
});
test("a tap calls onPick with the id", async () => {
  const onPick = vi.fn(); render(<BottleChips bottles={chips} selectedId={null} disabled={false} onPick={onPick} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Test entry A" })); expect(onPick).toHaveBeenCalledWith("test-a");
});
test("ignores clicks while disabled", async () => {
  const onPick = vi.fn(); render(<BottleChips bottles={chips} selectedId={null} disabled onPick={onPick} />);
  expect(screen.getByRole("button", { name: "Test entry A" })).toBeDisabled();
  await userEvent.setup().click(screen.getByRole("button", { name: "Test entry A" })); expect(onPick).not.toHaveBeenCalled();
});
test("empty list shows No bottles measured yet. and an Evidence link", () => {
  render(<BottleChips bottles={[]} selectedId={null} disabled={false} onPick={vi.fn()} />);
  expect(screen.getByText("No bottles measured yet.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Evidence" })).toHaveAttribute("href", "/evidence");
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});
test("has no axe violations", async () => {
  const { container } = render(<BottleChips bottles={chips} selectedId="test-a" disabled={false} onPick={vi.fn()} />);
  await expectNoAxeViolations(container);
});

test("the selected chip is amber, the others are not", () => {
  render(<BottleChips bottles={chips} selectedId="test-a" disabled={false} onPick={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Test entry A" })).toHaveClass("bg-amber");
  expect(screen.getByRole("button", { name: "Test entry B" })).not.toHaveClass("bg-amber");
});

test("a long bottle name wraps inside its chip", () => {
  render(<BottleChips bottles={[{ id: "test-a", name: "Test entry with a very long name that would not fit on a phone" }]} selectedId={null} disabled={false} onPick={vi.fn()} />);
  expect(screen.getByRole("button")).toHaveClass("max-w-full", "break-words");
});

test("the empty state has no axe violations", async () => {
  const { container } = render(<BottleChips bottles={[]} selectedId={null} disabled={false} onPick={vi.fn()} />);
  await expectNoAxeViolations(container);
});

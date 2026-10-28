// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { PillNav } from "@/ui/PillNav";
import { expectNoAxeViolations } from "../axe";

vi.mock("next/navigation", () => ({ usePathname: () => "/compare" }));

test("main nav lists Try, Compare, Evidence in order", () => {
  render(<PillNav />);
  const nav = screen.getByRole("navigation", { name: "Main" });
  expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Try", "Compare", "Evidence"]);
  expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/", "/compare", "/evidence"]);
});

test("marks only the current page", () => {
  render(<PillNav />);
  expect(screen.getAllByRole("link", { name: "Compare" })[0]).toHaveAttribute("aria-current", "page");
  const nav = screen.getByRole("navigation", { name: "Main" });
  expect(within(nav).getByRole("link", { name: "Try" })).not.toHaveAttribute("aria-current");
  expect(within(nav).getByRole("link", { name: "Evidence" })).not.toHaveAttribute("aria-current");
  expect(screen.getByTestId("phone-pill")).not.toHaveAttribute("aria-current");
});

test("the phone pill points at Evidence", () => {
  render(<PillNav />);
  const pill = screen.getByTestId("phone-pill");
  expect(pill).toHaveAttribute("href", "/evidence");
  expect(pill).toHaveTextContent("Evidence");
});

test("the brand pill links home with the name", () => {
  render(<PillNav />);
  expect(screen.getByRole("link", { name: "Cast Forecast" })).toHaveAttribute("href", "/");
});

// The pills float over every section, the ink footer included, so an outline drawn outside a pill can land
// on ink. Each pill draws its focus ring inside itself, and the ink phone pill draws it in amber.
test("every pill draws its focus ring inside itself, amber on the ink pill", () => {
  render(<PillNav />);
  for (const link of screen.getAllByRole("link")) expect(link.className).toContain("focus-visible:outline-offset-[-6px]!");
  expect(screen.getByTestId("phone-pill").className).toContain("focus-visible:outline-amber!");
});

test("has no axe violations", async () => {
  const { container } = render(<PillNav />);
  await expectNoAxeViolations(container);
});

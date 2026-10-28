// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Footer } from "@/ui/Footer";
import { expectNoAxeViolations } from "../axe";

test("links the source and the evidence", () => {
  render(<Footer />);
  const source = screen.getByRole("link", { name: /Source on GitHub/ });
  expect(source).toHaveAttribute("href", "https://github.com/StephenSook/cast-forecast");
  expect(source).toHaveAttribute("rel", "noreferrer");
  expect(source).toHaveAttribute("target", "_blank");
  expect(source).toHaveTextContent("Source on GitHub ↗");
  expect(screen.getByRole("link", { name: "Evidence" })).toHaveAttribute("href", "/evidence");
});

test("is an ink card with the mark and the name, and nothing else links out", () => {
  const { container } = render(<Footer />);
  expect(screen.getByRole("contentinfo").firstElementChild).toHaveClass("section-card", "bg-ink", "text-paper");
  expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByRole("contentinfo")).toHaveTextContent("Cast Forecast");
  expect(screen.getAllByRole("link")).toHaveLength(2);
});

test("has no axe violations", async () => {
  const { container } = render(<Footer />);
  await expectNoAxeViolations(container);
});

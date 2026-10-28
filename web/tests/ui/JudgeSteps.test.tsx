// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { JudgeSteps, type JudgeStep } from "@/ui/JudgeSteps";
import { expectNoAxeViolations } from "../axe";

const steps: JudgeStep[] = [
  { title: "Read the gates", body: "Rules first." },
  { title: "Read the code", body: "Tests run.", href: "https://github.com/StephenSook/cast-forecast", cta: "GitHub", external: true },
];

// Lullabuy /judge clipped its step cards: the grid track grew to the widest nowrap command.
test("the list cannot grow past its container", () => {
  const { container } = render(<JudgeSteps steps={steps} />);
  expect(container.querySelector("ol")).toHaveClass("grid-cols-[minmax(0,1fr)]");
  expect(container.querySelector("li > div")).toHaveClass("min-w-0");
  expect(container.innerHTML).not.toContain("text-amber-deep");
});

test("numbers each step with an ink numeral", () => {
  render(<JudgeSteps steps={steps} />);
  expect(screen.getAllByRole("listitem").map((li) => li.querySelector(".display")?.textContent)).toEqual(["1", "2"]);
  for (const li of screen.getAllByRole("listitem")) expect(li.querySelector(".display")).toHaveClass("text-ink");
});

test("an external step opens in a new tab with the arrow", () => {
  render(<JudgeSteps steps={steps} />);
  const link = screen.getByRole("link", { name: /GitHub/ });
  expect(link).toHaveAttribute("href", "https://github.com/StephenSook/cast-forecast");
  expect(link).toHaveAttribute("rel", "noreferrer");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveTextContent("↗");
});

test("an internal step stays in the tab, and a code step renders a copy line", () => {
  const { container } = render(
    <JudgeSteps steps={[{ title: "Check the gates", body: "One call.", code: "curl -s https://x/api/gates", href: "/evidence", cta: "Evidence" }]} />,
  );
  const link = screen.getByRole("link", { name: /Evidence/ });
  expect(link).toHaveAttribute("href", "/evidence");
  expect(link).not.toHaveAttribute("target");
  expect(link).toHaveTextContent("→");
  expect(container.querySelector("li > div code")).toHaveTextContent("curl -s https://x/api/gates");
  expect(within(screen.getByRole("listitem")).getByRole("button", { name: "Copy" })).toBeInTheDocument();
});

test("has no axe violations", async () => {
  const { container } = render(<JudgeSteps steps={steps} />);
  await expectNoAxeViolations(container);
});

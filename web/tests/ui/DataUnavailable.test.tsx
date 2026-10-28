// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ChartGuard } from "@/ui/DataUnavailable";
import { expectNoAxeViolations } from "../axe";

test("renders the chart when there is no problem", () => {
  render(<ChartGuard problem={null} what="the K1b curve"><p>chart here</p></ChartGuard>);
  expect(screen.getByText("chart here")).toBeInTheDocument();
  expect(screen.queryByText(/Data unavailable/)).toBeNull();
});

test("shows a named card instead of the chart, and never renders the child", () => {
  const Boom = () => { throw new Error("must not render"); };
  const { container } = render(<ChartGuard problem="point outside the axis" what="the K1b curve"><Boom /></ChartGuard>);
  expect(screen.getByText("Data unavailable: the K1b curve.")).toBeInTheDocument();
  expect(container).not.toHaveTextContent("point outside the axis");
});

test("has no axe violations", async () => {
  const { container } = render(<ChartGuard problem="bad" what="a chart"><p>x</p></ChartGuard>);
  await expectNoAxeViolations(container);
});

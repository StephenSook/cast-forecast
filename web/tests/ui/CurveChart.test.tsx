// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { CurveChart, curveProblem } from "@/ui/CurveChart";
import { expectNoAxeViolations } from "../axe";

// K1b isotonic fit from docs/gates/k1b-results.json (colorIntensity, blend strength).
const G = [[0, 0], [20, 0.0688], [40, 0.1405], [60, 0.2055], [80, 0.2729], [100, 0.3545]];
const POINTS = G.map(([x, y]) => ({ x, y }));
const LABEL = "K1b blend strength by colorIntensity: 0.355 at 100";

function chart() {
  return render(<CurveChart points={POINTS} yMax={0.4} xLabel="colorIntensity" ariaLabel={LABEL} />);
}

test("bar heights come from the pinned y axis, not the data maximum", () => {
  const { container } = chart();
  const bar = container.querySelector('rect[data-x="100"]')!;
  expect(Number(bar.getAttribute("height"))).toBeCloseTo((0.3545 / 0.4) * 70, 2);
  expect(Number(bar.getAttribute("y"))).toBeCloseTo(80 - (0.3545 / 0.4) * 70, 2);
  const mid = container.querySelector('rect[data-x="40"]')!;
  expect(Number(mid.getAttribute("height"))).toBeCloseTo((0.1405 / 0.4) * 70, 2);
});

test("is one labelled image with a bar per point inside a 336 x 82 frame", () => {
  const { container } = chart();
  const svg = screen.getByRole("img", { name: LABEL });
  expect(svg).toBeInTheDocument();
  expect(svg).toHaveAttribute("viewBox", "0 0 336 82");
  expect([...container.querySelectorAll("rect[data-x]")].map((r) => r.getAttribute("data-x"))).toEqual(["0", "20", "40", "60", "80", "100"]);
  const base = container.querySelector("line")!;
  expect(base.getAttribute("y1")).toBe("80.5");
  expect(base.getAttribute("y2")).toBe("80.5");
  expect(container).toHaveTextContent("colorIntensity 0");
  expect(container).toHaveTextContent("100");
});

// The SVG scales to the phone width, so text inside it rendered about 7 px at 390. The end labels are HTML
// under the chart instead, in text-sm (13 px at the 15 px phone root), and the SVG holds no text at all.
test("end labels are HTML at least text-sm, and the SVG holds no text", () => {
  const { container } = chart();
  expect(container.querySelectorAll("svg text")).toHaveLength(0);
  const labels = [...container.querySelectorAll("[data-chart-label]")];
  expect(labels.map((l) => l.textContent)).toEqual(["colorIntensity 0", "100"]);
  for (const l of labels) expect(l.className).toContain("text-sm");
});

test("curveProblem names what the pinned axis cannot draw, and null for good data", () => {
  expect(curveProblem(POINTS, 0.4)).toBeNull();
  expect(curveProblem([], 0.4)).toMatch(/at least one point/);
  expect(curveProblem(POINTS, 0)).toMatch(/yMax/);
  expect(curveProblem([{ x: 0, y: 0.5 }], 0.4)).toMatch(/outside the pinned axis/);
  expect(curveProblem([{ x: 0, y: Number.NaN }], 0.4)).toMatch(/outside the pinned axis/);
});

test("refuses points it cannot draw on the pinned axis", () => {
  expect(() => render(<CurveChart points={[{ x: 0, y: 0.5 }]} yMax={0.4} xLabel="x" ariaLabel="a" />)).toThrow(RangeError);
  expect(() => render(<CurveChart points={[{ x: 0, y: -0.1 }]} yMax={0.4} xLabel="x" ariaLabel="a" />)).toThrow(RangeError);
  expect(() => render(<CurveChart points={[]} yMax={0.4} xLabel="x" ariaLabel="a" />)).toThrow(RangeError);
  expect(() => render(<CurveChart points={[{ x: 0, y: 0 }]} yMax={0} xLabel="x" ariaLabel="a" />)).toThrow(RangeError);
});

test("has no axe violations", async () => {
  const { container } = chart();
  await expectNoAxeViolations(container);
});

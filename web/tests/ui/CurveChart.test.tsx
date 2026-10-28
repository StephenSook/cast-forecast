// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { CurveChart } from "@/ui/CurveChart";
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

test("is one labelled image with a bar per point inside a 336 x 90 frame", () => {
  const { container } = chart();
  const svg = screen.getByRole("img", { name: LABEL });
  expect(svg).toBeInTheDocument();
  expect(svg).toHaveAttribute("viewBox", "0 0 336 90");
  expect([...container.querySelectorAll("rect[data-x]")].map((r) => r.getAttribute("data-x"))).toEqual(["0", "20", "40", "60", "80", "100"]);
  const base = container.querySelector("line")!;
  expect(base.getAttribute("y1")).toBe("80.5");
  expect(base.getAttribute("y2")).toBe("80.5");
  expect(svg).toHaveTextContent("colorIntensity 0");
  expect(svg).toHaveTextContent("100");
});

// Lullabuy drew its end labels on y 90, the frame's bottom edge, so descenders (the y in colorIntensity) were cut.
test("end labels sit high enough that descenders stay inside the frame", () => {
  const { container } = chart();
  const labels = [...container.querySelectorAll("text")];
  expect(labels).toHaveLength(2);
  for (const t of labels) expect(Number(t.getAttribute("y")) + 0.25 * Number(t.getAttribute("font-size"))).toBeLessThanOrEqual(90);
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

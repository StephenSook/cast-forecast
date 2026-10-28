// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { Bars, barGeometry, type BarRow } from "@/ui/Bars";
import { expectNoAxeViolations } from "../axe";

test("geometry uses the shared domain, not the row maximum", () => {
  expect(barGeometry({ label: "a", value: 2 }, [0, 10]).mark).toBe(20);
  expect(barGeometry({ label: "b", value: 4 }, [0, 10]).mark).toBe(40);
  expect(barGeometry({ label: "c", value: 12, low: -1, high: 13 }, [0, 10])).toEqual({ start: 0, end: 100, mark: 100 });
});

test("a row with no interval fills from the domain start to the value", () => {
  expect(barGeometry({ label: "a", value: 2 }, [0, 10])).toEqual({ start: 0, end: 20, mark: 20 });
  expect(barGeometry({ label: "a", value: 0 }, [-1, 1])).toEqual({ start: 0, end: 50, mark: 50 });
  expect(barGeometry({ label: "a", value: 3, low: 2, high: 5 }, [0, 10])).toEqual({ start: 20, end: 50, mark: 30 });
});

test("refuses a domain or row it cannot draw", () => {
  expect(() => barGeometry({ label: "a", value: 1 }, [5, 5])).toThrow(RangeError);
  expect(() => barGeometry({ label: "a", value: 1 }, [10, 0])).toThrow(RangeError);
  expect(() => barGeometry({ label: "a", value: Number.NaN }, [0, 10])).toThrow(RangeError);
  expect(() => barGeometry({ label: "a", value: 1, low: 4, high: 2 }, [0, 10])).toThrow(RangeError);
});

const rows: BarRow[] = [
  { label: "Bottle A", value: 2 },
  { label: "Bottle B", value: 4, low: 3, high: 5 },
];

test("renders each row with its label and formatted value, widths from the shared domain", () => {
  const { container } = render(<Bars rows={rows} domain={[0, 10]} format={(v) => v.toFixed(1)} ariaLabel="Whitening by bottle" />);
  const list = screen.getByRole("list", { name: "Whitening by bottle" });
  const items = within(list).getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent("Bottle A");
  expect(items[0]).toHaveTextContent("2.0");
  expect(items[1]).toHaveTextContent("4.0");
  expect(items[1]).toHaveTextContent("3.0 to 5.0");
  const fills = container.querySelectorAll<HTMLElement>("[data-bar-fill]");
  expect(fills[0].style.left).toBe("0%");
  expect(fills[0].style.width).toBe("20%");
  expect(fills[1].style.left).toBe("30%");
  expect(fills[1].style.width).toBe("20%");
});

test("has no axe violations", async () => {
  const { container } = render(<Bars rows={rows} domain={[0, 10]} format={(v) => v.toFixed(1)} ariaLabel="Whitening by bottle" />);
  await expectNoAxeViolations(container);
});

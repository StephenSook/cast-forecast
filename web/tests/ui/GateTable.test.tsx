// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { GateRow } from "@/lib/gates";
import { GateTable } from "@/ui/GateTable";
import { expectNoAxeViolations } from "../axe";

const row = (o: Partial<GateRow>): GateRow => ({ gate: "G", question: "Q?", rule: "r", result: "PASS 5 of 5. [r.md](r.md)", verdict: "PASS", links: [], ...o });

test("one row per gate, the verdict as a word chip, and result links resolved to GitHub", () => {
  render(<GateTable gates={[row({ gate: "K1b" }), row({ gate: "K2", result: "FAIL 2 of 3: moved little.", verdict: "FAIL" })]} />);
  const rows = screen.getAllByRole("row").filter((r) => within(r).queryAllByRole("cell").length > 0);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("K1b");
  expect(rows[0]).toHaveTextContent("PASS");
  expect(rows[0]).toHaveTextContent("5 of 5.");
  expect(rows[0].textContent).not.toMatch(/PASS\s*PASS/);
  expect(rows[1]).toHaveTextContent("FAIL");
  expect(within(rows[0]).getByText("PASS").className).toContain("bg-amber-soft");
  expect(within(rows[1]).getByText("FAIL").className).toContain("bg-red-soft");
  expect(rows[1]).toHaveTextContent("2 of 3: moved little.");
  expect(within(rows[0]).getByRole("link", { name: /r\.md/ })).toHaveAttribute("href", "https://github.com/StephenSook/cast-forecast/blob/main/docs/gates/r.md");
  expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Gate", "Question", "Result"]);
});

test("a result with no PASS or FAIL word keeps its whole text under a NOTE chip", () => {
  render(<GateTable gates={[row({ result: "Pending the run.", verdict: "OTHER" })]} />);
  const r = screen.getAllByRole("row")[1];
  expect(r).toHaveTextContent("NOTE");
  expect(r).toHaveTextContent("Pending the run.");
});

test("has no axe violations", async () => {
  const { container } = render(<GateTable gates={[row({}), row({ gate: "K2", verdict: "FAIL", result: "FAIL 2 of 3." })]} />);
  await expectNoAxeViolations(container);
});

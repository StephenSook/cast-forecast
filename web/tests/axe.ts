import axe from "axe-core";
import { expect } from "vitest";

/**
 * Runs axe-core on a rendered element and fails with one line per violation.
 * `color-contrast` and `region` are off because jsdom has no layout; contrast is covered by
 * tests/unit/tokens.test.ts and by Playwright axe on the real browser.
 */
export async function expectNoAxeViolations(el: Element): Promise<void> {
  const results = await axe.run(el, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
  });
  const lines = results.violations.map(
    (v) => `${v.id}: ${v.help} at ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(lines).toEqual([]);
}

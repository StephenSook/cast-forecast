// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { BottleSearch } from "@/ui/BottleSearch";
import { expectNoAxeViolations } from "../axe";
import { deferred } from "../helpers/deferred";
import { testEntry } from "../helpers/entries";

const a = testEntry({ id: "test-a", name: "Test entry A", brand: "Brand A" });
const b = testEntry({ id: "test-b", name: "Test entry B", brand: "Brand B" });

function setup(search = vi.fn(async (q: string) => ({ total: q.includes("b") ? 1 : 2, bottles: q.includes("b") ? [b] : [a, b] }))) {
  const onSelect = vi.fn();
  const user = userEvent.setup();
  const view = render(<BottleSearch search={search} onSelect={onSelect} disabled={false} />);
  const box = screen.getByRole("combobox", { name: "Find your sunscreen" });
  return { search, onSelect, user, box, ...view };
}

test("typing asks once the typing pauses, and lists each result with its brand and zinc", async () => {
  const { search, user, box, container } = setup();
  await user.type(box, "test");
  const list = await screen.findByRole("listbox", { name: "Sunscreens" });
  const options = within(list).getAllByRole("option");
  expect(options.map((o) => o.textContent)).toEqual(["Test entry ABrand A, 20% zinc oxide", "Test entry BBrand B, 20% zinc oxide"]);
  expect(search.mock.calls.at(-1)?.[0]).toBe("test");
  expect(search.mock.calls.length).toBeLessThan(4); // debounced, not one call per key
  expect(box).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("status")).toHaveTextContent("2 found.");
  await expectNoAxeViolations(container);
});

test("arrow keys move the active option and Enter picks it, closing and clearing the field", async () => {
  const { onSelect, user, box } = setup();
  await user.type(box, "test");
  await screen.findByRole("listbox");
  await user.keyboard("{ArrowDown}{ArrowDown}");
  const active = box.getAttribute("aria-activedescendant");
  expect(active && document.getElementById(active)).toHaveTextContent("Test entry B");
  expect(screen.getByRole("option", { name: /Test entry B/ })).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{Enter}");
  expect(onSelect).toHaveBeenCalledWith(b);
  expect(box).toHaveValue("");
  expect(box).toHaveAttribute("aria-expanded", "false");
});

test("a tap on an option picks it", async () => {
  const { onSelect, user, box } = setup();
  await user.type(box, "test");
  await user.click(await screen.findByRole("option", { name: /Test entry A/ }));
  expect(onSelect).toHaveBeenCalledWith(a);
});

test("Escape closes the list, then clears the field", async () => {
  const { user, box } = setup();
  await user.type(box, "test");
  await screen.findByRole("listbox");
  await user.keyboard("{Escape}");
  expect(box).toHaveAttribute("aria-expanded", "false");
  expect(box).toHaveValue("test");
  await user.keyboard("{Escape}");
  expect(box).toHaveValue("");
});

test("an older answer that arrives late never replaces a newer one", async () => {
  const slow = deferred<{ total: number; bottles: typeof a[] }>();
  const search = vi.fn((q: string) => (q === "te" ? slow.promise : Promise.resolve({ total: 1, bottles: [b] })));
  const { user, box } = setup(search);
  await user.type(box, "te");
  await waitFor(() => expect(search).toHaveBeenCalledWith("te", expect.anything()));
  await user.type(box, "st b");
  await screen.findByRole("option", { name: /Test entry B/ });
  slow.resolve({ total: 1, bottles: [a] });
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByRole("option", { name: /Test entry A/ })).toBeNull();
});

test("no match says so in one line, and the field does not claim an open list", async () => {
  const { user, box } = setup(vi.fn(async () => ({ total: 0, bottles: [] })));
  await user.type(box, "zzz");
  expect(await screen.findByText("No bottle by that name.")).toBeInTheDocument();
  expect(screen.queryByRole("option")).toBeNull();
  expect(box).toHaveAttribute("aria-expanded", "false");
  expect(box).not.toHaveAttribute("aria-activedescendant");
});

test("a query with nothing a name could match is never sent, and reads as no match", async () => {
  const search = vi.fn(async () => ({ total: 1, bottles: [a] }));
  const { user, box } = setup(search);
  await user.type(box, "&&");
  expect(await screen.findByText("No bottle by that name.")).toBeInTheDocument();
  await new Promise((r) => setTimeout(r, 300)); // past the debounce
  expect(search).not.toHaveBeenCalled();
  expect(box).toHaveAttribute("aria-expanded", "false");
});

test("a failed search says the search is not answering, until the next keystroke", async () => {
  const search = vi.fn(async (q: string) => {
    if (q === "zzz") throw new Error("down");
    return { total: 1, bottles: [a] };
  });
  const { user, box } = setup(search);
  await user.type(box, "zzz");
  expect(await screen.findByText("Search is not answering. Try again.")).toBeInTheDocument();
  expect(box).toHaveAttribute("aria-expanded", "false");
  await user.clear(box);
  await user.type(box, "test");
  expect(await screen.findByRole("option", { name: /Test entry A/ })).toBeInTheDocument();
  expect(screen.queryByText("Search is not answering. Try again.")).toBeNull();
});

test("more results than shown says how many there are", async () => {
  const { user, box } = setup(vi.fn(async () => ({ total: 40, bottles: [a, b] })));
  await user.type(box, "test");
  expect(await screen.findByText("2 of 40. Keep typing to narrow it.")).toBeInTheDocument();
});

"use client";

import { type KeyboardEvent, useEffect, useId, useState } from "react";
import type { SearchAnswer } from "@/lib/apiClient";
import type { Bottle } from "@/lib/catalogue";

/** Wait after the last keystroke before asking the server. */
export const SEARCH_DEBOUNCE_MS = 150;

type Search = (query: string, signal: AbortSignal) => Promise<SearchAnswer>;

/**
 * "Find your sunscreen": a combobox (ARIA 1.2, list autocomplete) over every FDA label the server knows. Typing asks
 * `search` (debounced; an older answer never replaces a newer one); arrow keys move through the results, Enter or a tap
 * picks one, Escape closes the list and then clears the field. Picking hands the full entry to `onSelect`, which picks
 * it exactly as a chip would.
 */
export function BottleSearch({ search, onSelect, disabled }: { search: Search; onSelect(b: Bottle): void; disabled: boolean }) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<{ query: string; total: number; bottles: Bottle[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      search(q, ctrl.signal).then(
        (a) => {
          if (ctrl.signal.aborted) return;
          setAnswer({ query: q, ...a });
          setFailed(false);
          setActive(-1);
        },
        () => {
          if (!ctrl.signal.aborted) setFailed(true);
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, search]);

  const results = query.trim() && answer ? answer.bottles : [];
  const shown = open && query.trim() !== "" && (results.length > 0 || failed || answer?.query === query.trim());
  const choose = (b: Bottle) => {
    setOpen(false);
    setQuery("");
    setAnswer(null);
    setActive(-1);
    onSelect(b);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (results.length === 0) return;
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
    } else if (e.key === "Enter") {
      if (shown && active >= 0 && results[active]) {
        e.preventDefault();
        choose(results[active]);
      }
    } else if (e.key === "Escape") {
      if (shown) setOpen(false);
      else setQuery("");
      setActive(-1);
    }
  };

  const status = !shown
    ? ""
    : failed
      ? "Search is not answering. Try again."
      : !answer || answer.total === 0
        ? "No bottle by that name."
        : answer.total > results.length
          ? `${results.length} of ${answer.total}. Keep typing to narrow it.`
          : `${answer.total} found.`;

  return (
    <div className="grid gap-2 max-w-[34rem]">
      <label htmlFor={id} className="font-bold">
        Find your sunscreen
      </label>
      <input
        id={id}
        type="search"
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        maxLength={60}
        disabled={disabled}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="min-h-11 w-full rounded-full border-2 border-ink bg-paper px-4 font-bold shadow-[0_2px_0_var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Sunscreens"
        hidden={!shown || results.length === 0}
        // In the flow, not floating: the section card clips what overflows it, and on a phone the field sits near its end.
        className="max-h-80 overflow-y-auto rounded-3xl border-2 border-ink bg-paper p-2 shadow-[0_4px_0_var(--ink)]"
      >
        {results.map((b, i) => (
          <li
            key={b.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            // Keeps focus in the field, so a tap does not close the list before it lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(b)}
            className={`cursor-pointer rounded-2xl px-3 py-2 ${i === active ? "bg-amber" : "hover:bg-amber-soft"}`}
          >
            <span className="block font-bold break-words">{b.name}</span>
            <span className="block text-sm font-bold">
              {b.brand}, {b.evidence.zincOxidePct}% zinc oxide
            </span>
          </li>
        ))}
      </ul>
      <p role="status" className="text-sm font-bold min-h-[1.25em]">
        {status}
      </p>
    </div>
  );
}

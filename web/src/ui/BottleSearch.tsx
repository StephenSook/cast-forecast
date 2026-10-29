"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { SearchAnswer } from "@/lib/apiClient";
import type { Bottle } from "@/lib/catalogue";
import { foldText } from "@/lib/search";

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
  // True between compositionstart and compositionend (an IME is building text: Japanese, Chinese, Korean, dead keys).
  const composing = useRef(false);

  useEffect(() => {
    const q = query.trim();
    // Nothing a name could match ("&", "++"): the server would refuse it, so it is never sent.
    if (!foldText(q)) return;
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

  const q = query.trim();
  const searchable = foldText(q) !== "";
  // Only the answer to what the field says now: while a newer query is pending, an older answer's bottles are not
  // options at all, so no key or tap can pick one (a pick starts a paid render).
  const current = searchable && answer?.query === q ? answer : null;
  const results = current ? current.bottles : [];
  // The panel (list and status line) shows once there is something to say about this query.
  const shown = open && q !== "" && (!searchable || failed || current !== null);
  // What a screen reader is told is open: the list itself, only when it has options.
  const listed = shown && results.length > 0;
  const choose = (b: Bottle) => {
    setOpen(false);
    setQuery("");
    setAnswer(null);
    setActive(-1);
    onSelect(b);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // While an IME composes, its arrows and Enter choose and confirm the IME's text, not a bottle (a pick starts a paid
    // render). Browsers flag it in different ways, so any one of them is enough.
    if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (results.length === 0) return;
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
    } else if (e.key === "Enter") {
      if (listed && active >= 0 && results[active]) {
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
    : !searchable
      ? "No bottle by that name."
      : failed
        ? "Search is not answering. Try again."
        : !current || current.total === 0
          ? "No bottle by that name."
          : current.total > results.length
            ? `${results.length} of ${current.total}. Keep typing to narrow it.`
            : `${current.total} found.`;

  return (
    <div data-testid="bottle-search" className="grid gap-2 max-w-[34rem]">
      <label htmlFor={id} className="font-bold">
        Find your sunscreen
      </label>
      <input
        id={id}
        type="search"
        role="combobox"
        aria-expanded={listed}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={listed && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        maxLength={60}
        disabled={disabled}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setFailed(false); // a failure speaks for the query that failed, not the next one
          setActive(-1); // an active option belonged to the old text
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          composing.current = false;
          setOpen(false);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={onKeyDown}
        className="min-h-11 w-full rounded-full border-2 border-ink bg-paper px-4 font-bold shadow-[0_2px_0_var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Sunscreens"
        hidden={!listed}
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

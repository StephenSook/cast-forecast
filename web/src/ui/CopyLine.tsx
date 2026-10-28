"use client";

import { useEffect, useRef, useState } from "react";

const FAILED = "Copy failed. Select the text.";

/**
 * A command a stranger can copy with one tap (adapted from Lullabuy src/ui/CopyLine.tsx).
 * The button always reads "Copy"; the outcome is announced in a status line, and a failed copy says so
 * instead of being swallowed. The command scrolls inside its own box, so a long URL never widens the page.
 */
export function CopyLine({ text }: { text: string }) {
  const [said, setSaid] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setSaid("Copied");
      timer.current = setTimeout(() => setSaid(""), 1500);
    } catch {
      // The clipboard API is missing (insecure context) or the browser refused it. Say so; the text is selectable.
      setSaid(FAILED);
    }
  };

  return (
    <div className="mt-3 min-w-0">
      <div className="flex items-stretch rounded-xl border-2 border-ink overflow-hidden bg-ink text-paper">
        <code
          tabIndex={0}
          className="flex-1 min-w-0 px-4 py-3 text-sm overflow-x-auto whitespace-nowrap select-all focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-amber focus-visible:outline-offset-[-3px]"
        >
          {text}
        </code>
        <button
          type="button"
          onClick={copy}
          className="px-4 font-bold bg-amber text-ink shrink-0 focus-visible:outline-focus! focus-visible:outline-offset-[-6px]!"
        >
          Copy
        </button>
      </div>
      <p role="status" className="mt-1 min-h-[1.25em] text-sm font-bold">
        {said}
      </p>
    </div>
  );
}

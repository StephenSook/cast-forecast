"use client";

import { useRef, type ReactNode } from "react";
import { gsap, prefersReducedMotion, setupGsap, useGSAP } from "./motion/gsap";

export type Tone = "paper" | "amber" | "aqua" | "ink";

// Ink is an ink surface (paper text, amber focus via .on-ink); the light tones take ink text.
const TONE: Record<Tone, string> = {
  paper: "bg-paper text-ink",
  amber: "bg-amber text-ink",
  aqua: "bg-aqua text-ink",
  ink: "bg-ink text-paper on-ink",
};

/**
 * One huge word and one line (pattern from Lullabuy src/ui/Checkpoint.tsx:362-368). It pops in from small and
 * tilted whenever the word changes (Lullabuy PickupScanner.tsx:352-356), and holds still under reduced motion.
 */
export function ResultBlock({ word, line, tone = "paper", children }: { word: string; line: string; tone?: Tone; children?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !root.current) return;
      setupGsap();
      gsap.fromTo(root.current, { scale: 0.6, rotate: -8 }, { scale: 1, rotate: 0, duration: 0.8, ease: "elastic.out(1,0.6)" });
    },
    { dependencies: [word] },
  );
  return (
    <div
      ref={root}
      data-testid="result"
      aria-live="polite"
      className={`rounded-[2rem] sm:rounded-[3rem] border-[3px] border-ink p-6 sm:p-10 grid content-center gap-4 min-w-0 ${TONE[tone]}`}
    >
      <div className="min-w-0">
        <p className="display text-[clamp(3.2rem,12vw,11rem)] break-words">{word}</p>
        <p className="mt-2 text-lg sm:text-2xl font-bold max-w-[34em]">{line}</p>
      </div>
      {children}
    </div>
  );
}

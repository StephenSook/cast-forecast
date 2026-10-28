import Link from "next/link";
import { CopyLine } from "./CopyLine";

export type JudgeStep = { title: string; body: string; code?: string; href?: string; cta?: string; external?: boolean };

const CTA = "inline-block mt-3 font-extrabold underline decoration-[3px] underline-offset-4 decoration-amber wrap-anywhere";

/**
 * Numbered step cards (pattern from Lullabuy src/app/judge/page.tsx:66-82). Lullabuy's cards were clipped:
 * the grid track grew to the widest nowrap command. Here the track is minmax(0,1fr) and the text column is
 * min-w-0, so a long command scrolls inside its CopyLine instead. Numerals are ink (amber-deep failed contrast).
 */
export function JudgeSteps({ steps }: { steps: readonly JudgeStep[] }) {
  return (
    <ol role="list" className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {steps.map((s, i) => (
        <li
          key={`${i}-${s.title}`}
          className="rounded-[2rem] bg-paper text-ink border-[3px] border-ink p-6 shadow-[6px_8px_0_var(--ink)] grid sm:grid-cols-[4rem_minmax(0,1fr)] gap-4"
        >
          <span className="display text-5xl text-ink">{i + 1}</span>
          <div className="min-w-0">
            <h2 className="display text-2xl">{s.title}</h2>
            <p className="mt-2 font-semibold">{s.body}</p>
            {s.code && <CopyLine text={s.code} />}
            {s.href && s.external && (
              <a href={s.href} target="_blank" rel="noreferrer" className={CTA}>
                {s.cta ?? s.href} <span aria-hidden="true">↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
            {s.href && !s.external && (
              <Link href={s.href} className={CTA}>
                {s.cta ?? s.href} <span aria-hidden="true">→</span>
              </Link>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

import Link from "next/link";
import { Mark } from "./Mark";

const REPO = "https://github.com/StephenSook/cast-forecast";

/** Footer: an ink section card with the mark, the name, the source and the evidence (adapted from Lullabuy). */
export function Footer() {
  return (
    <footer className="px-3 pb-3">
      <div className="section-card bg-ink text-paper px-6 sm:px-12 py-10 flex flex-wrap items-center justify-between gap-x-8 gap-y-6">
        <div className="flex items-center gap-3">
          <Mark size={36} />
          <span className="display text-2xl">Cast Forecast</span>
        </div>
        <p className="flex flex-wrap gap-x-6 gap-y-3 font-bold">
          <a href={REPO} target="_blank" rel="noreferrer" className="underline decoration-2 underline-offset-4">
            Source on GitHub <span aria-hidden="true">↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <Link href="/evidence" className="underline decoration-2 underline-offset-4">
            Evidence
          </Link>
        </p>
      </div>
    </footer>
  );
}

import type { ReactNode } from "react";

/** The card a chart shows when its data cannot be drawn. It names the chart and says nothing else. */
export function DataUnavailable({ what }: { what: string }) {
  return (
    <div className="rounded-[2rem] border-[3px] border-ink bg-paper text-ink p-5 font-bold">
      Data unavailable: {what}.
    </div>
  );
}

/**
 * Renders `children` (a chart) only when `problem` is null. Otherwise it shows the card, so a bad data file
 * degrades one chart instead of failing the page. The problem text is for logs and tests, never shown.
 */
export function ChartGuard({ problem, what, children }: { problem: string | null; what: string; children: ReactNode }) {
  if (problem) {
    console.error(`Chart not drawn (${what}): ${problem}`);
    return <DataUnavailable what={what} />;
  }
  return <>{children}</>;
}

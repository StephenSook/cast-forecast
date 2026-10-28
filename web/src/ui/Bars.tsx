export type BarRow = { label: string; value: number; low?: number; high?: number };

/**
 * Where a row sits on the shared domain, in percent of the track, each clamped to 0..100.
 * `start` is `low` (or the domain start), `end` is `high` (or the value), `mark` is the value.
 * Every row uses the same domain, never its own maximum, so equal values draw equal bars across charts.
 * Throws RangeError for anything it cannot draw honestly: an empty or reversed domain, a non-finite number,
 * or `low` above `high`.
 */
export function barGeometry(r: BarRow, domain: readonly [number, number]): { start: number; end: number; mark: number } {
  const [lo, hi] = domain;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) throw new RangeError(`bad domain [${lo}, ${hi}]`);
  for (const v of [r.value, r.low, r.high]) {
    if (v !== undefined && !Number.isFinite(v)) throw new RangeError(`${r.label}: ${v} is not a finite number`);
  }
  if (r.low !== undefined && r.high !== undefined && r.low > r.high) throw new RangeError(`${r.label}: low ${r.low} is above high ${r.high}`);
  // Multiply before dividing so round values stay exact (2 of 10 is 20, not 20.000000000000004).
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - lo) * 100) / (hi - lo)));
  return { start: pct(r.low ?? lo), end: pct(r.high ?? r.value), mark: pct(r.value) };
}

/** Why these rows cannot be drawn on this domain, or null when every row can. */
export function barsProblem(rows: readonly BarRow[], domain: readonly [number, number]): string | null {
  try {
    for (const r of rows) barGeometry(r, domain);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * Horizontal bars on one shared domain (pattern from Lullabuy src/app/trust/page.tsx:27-46). The track is
 * decoration; each row's text carries the value and its interval. On phones the bar takes its own line.
 */
export function Bars({ rows, domain, format, ariaLabel }: {
  rows: readonly BarRow[];
  domain: readonly [number, number];
  format: (v: number) => string;
  ariaLabel: string;
}) {
  return (
    <ul className="grid gap-3" aria-label={ariaLabel}>
      {rows.map((r, i) => {
        const g = barGeometry(r, domain);
        const interval = r.low !== undefined && r.high !== undefined ? ([r.low, r.high] as const) : null;
        return (
          <li key={`${i}-${r.label}`} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
            <span className="text-sm font-bold min-w-0 break-words">{r.label}</span>
            <span className="relative h-7 rounded-full border-2 border-ink bg-paper overflow-hidden col-span-2 order-last sm:col-span-1 sm:order-none" aria-hidden="true">
              <span data-bar-fill className="absolute inset-y-0 bg-amber" style={{ left: `${g.start}%`, width: `${g.end - g.start}%` }} />
              <span className="absolute inset-y-0 w-[3px] bg-ink" style={{ left: `calc(${g.mark}% - 1.5px)` }} />
            </span>
            <span className="font-extrabold tabular-nums text-right">
              {format(r.value)}
              {interval && <span className="block text-sm font-bold">{format(interval[0])} to {format(interval[1])}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

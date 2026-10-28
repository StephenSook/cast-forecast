const W = 336;
const PLOT = 70;
const BASE = 80;

type Point = { x: number; y: number };

/** Why the pinned axis cannot draw these points, or null when it can. */
export function curveProblem(points: readonly Point[], yMax: number): string | null {
  if (points.length === 0) return "CurveChart needs at least one point";
  if (!Number.isFinite(yMax) || !(yMax > 0)) return `yMax must be above 0, got ${yMax}`;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.y < 0 || p.y > yMax) {
      return `point (${p.x}, ${p.y}) is outside the pinned axis 0..${yMax}`;
    }
  }
  return null;
}

/**
 * Column chart on a pinned y axis (frame from Lullabuy src/app/trust/page.tsx:48-62): viewBox 336 x 82,
 * plot height 70, ink baseline at y 80.5. Each bar is (y / yMax) * 70 tall, so the axis never zooms to the data.
 * The end labels are HTML under the SVG: text inside a viewBox that scales to a 390 px phone drew at about 7 px.
 * Throws RangeError for anything the pinned axis cannot show (see curveProblem); pages check curveProblem first
 * and show a "data unavailable" card instead.
 */
export function CurveChart({ points, yMax, ariaLabel, xLabel }: {
  points: readonly Point[];
  yMax: number;
  ariaLabel: string;
  xLabel: string;
}) {
  const problem = curveProblem(points, yMax);
  if (problem) throw new RangeError(problem);
  const slot = W / points.length;
  const bw = slot * 0.7;
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} 82`} className="w-full h-auto max-h-48" role="img" aria-label={ariaLabel}>
        {points.map((p, i) => {
          const h = (p.y / yMax) * PLOT;
          return (
            <rect key={`${i}-${p.x}`} data-x={p.x} x={i * slot + (slot - bw) / 2} y={BASE - h} width={bw} height={h} rx={2} fill="var(--ink)">
              <title>{`${xLabel} ${p.x}: ${p.y}`}</title>
            </rect>
          );
        })}
        <line x1="0" y1="80.5" x2={W} y2="80.5" stroke="var(--ink)" strokeWidth="1" />
      </svg>
      <div className="mt-1 flex justify-between gap-3">
        <span data-chart-label className="text-sm font-bold">{`${xLabel} ${first.x}`}</span>
        <span data-chart-label className="text-sm font-bold">{`${last.x}`}</span>
      </div>
    </div>
  );
}

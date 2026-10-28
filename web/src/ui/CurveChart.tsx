const W = 336;
const PLOT = 70;
const BASE = 80;

/**
 * Column chart on a pinned y axis (frame from Lullabuy src/app/trust/page.tsx:48-62): viewBox 336 x 90,
 * plot height 70, ink baseline at y 80.5. Each bar is (y / yMax) * 70 tall, so the axis never zooms to the data.
 * Throws RangeError for anything the pinned axis cannot show: no points, yMax not above 0, or y outside 0..yMax.
 */
export function CurveChart({ points, yMax, ariaLabel, xLabel }: {
  points: readonly { x: number; y: number }[];
  yMax: number;
  ariaLabel: string;
  xLabel: string;
}) {
  if (points.length === 0) throw new RangeError("CurveChart needs at least one point");
  if (!Number.isFinite(yMax) || !(yMax > 0)) throw new RangeError(`yMax must be above 0, got ${yMax}`);
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.y < 0 || p.y > yMax) {
      throw new RangeError(`point (${p.x}, ${p.y}) is outside the pinned axis 0..${yMax}`);
    }
  }
  const slot = W / points.length;
  const bw = slot * 0.7;
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} 90`} className="w-full h-auto max-h-48" role="img" aria-label={ariaLabel}>
      {points.map((p, i) => {
        const h = (p.y / yMax) * PLOT;
        return (
          <rect key={`${i}-${p.x}`} data-x={p.x} x={i * slot + (slot - bw) / 2} y={BASE - h} width={bw} height={h} rx={2} fill="var(--ink)">
            <title>{`${xLabel} ${p.x}: ${p.y}`}</title>
          </rect>
        );
      })}
      <line x1="0" y1="80.5" x2={W} y2="80.5" stroke="var(--ink)" strokeWidth="1" />
      {/* Baseline at 88, not Lullabuy's 90, so descenders stay inside the frame. */}
      <text x="0" y="88" fontSize="8" fill="currentColor">{`${xLabel} ${first.x}`}</text>
      <text x={W} y="88" fontSize="8" textAnchor="end" fill="currentColor">{`${last.x}`}</text>
    </svg>
  );
}

/**
 * Our mark, the same drawing as src/app/icon.svg: a face oval whose right half is paper-white for the cast,
 * beside an amber dot, on an ink square with a paper ring, so it still shows on the ink footer. Inline SVG so it scales with the type and follows the tokens.
 */
export function Mark({ size = 48, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect x="1" y="1" width="62" height="62" rx="15" fill="var(--ink)" stroke="var(--paper)" strokeWidth="2" />
      <circle cx="47" cy="16" r="8" fill="var(--amber)" />
      <ellipse cx="29" cy="38" rx="15" ry="19" fill="var(--sand)" />
      <path d="M29 19a15 19 0 0 1 0 38z" fill="var(--paper)" />
    </svg>
  );
}

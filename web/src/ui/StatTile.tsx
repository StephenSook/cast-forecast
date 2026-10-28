// Light fills only, each with ink text (tokens.ts TEXT_ON_FILL). No green or red fills: paper on them fails.
const TONE = { paper: "bg-paper", amber: "bg-amber", aqua: "bg-aqua", sand: "bg-sand" } as const;

/** One measured number and what it means (pattern from Lullabuy src/app/trust/page.tsx:64-80). */
export function StatTile({ value, label, tone = "paper" }: { value: string; label: string; tone?: keyof typeof TONE }) {
  return (
    <div className={`rounded-[2rem] border-[3px] border-ink ${TONE[tone]} text-ink p-5 min-w-0`}>
      <p className="display text-4xl tabular-nums break-words">{value}</p>
      <p className="mt-2 font-bold">{label}</p>
    </div>
  );
}

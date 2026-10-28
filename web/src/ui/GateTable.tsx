import { cellParts } from "@/lib/evidence";
import type { GateRow } from "@/lib/gates";

const CHIP: Record<GateRow["verdict"], string> = {
  PASS: "bg-amber-soft",
  FAIL: "bg-red-soft",
  OTHER: "bg-paper",
};

function Cell({ text }: { text: string }) {
  return (
    <>
      {cellParts(text).map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noreferrer" className="underline decoration-2 underline-offset-4 decoration-amber wrap-anywhere">
            {p.text}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

// The leading verdict word becomes the chip, so it is not printed twice.
const LEAD = /^(PASS|FAIL)\b[:.]?\s*/i;

/**
 * The gates table: Gate, Question, Result. On phones each row stacks as a card; the roles are stated because a
 * display change can drop table semantics. The verdict chip is ink text on a light fill, always with the word.
 */
export function GateTable({ gates }: { gates: readonly GateRow[] }) {
  return (
    <div role="table" aria-label="Gates and their results" className="mt-6 block text-sm sm:table w-full border-collapse">
      <div role="rowgroup" className="sr-only sm:not-sr-only sm:table-header-group">
        <div role="row" className="sm:table-row font-extrabold">
          <div role="columnheader" className="sm:table-cell p-3 text-left">Gate</div>
          <div role="columnheader" className="sm:table-cell p-3 text-left">Question</div>
          <div role="columnheader" className="sm:table-cell p-3 text-left">Result</div>
        </div>
      </div>
      <div role="rowgroup" className="block sm:table-row-group">
        {gates.map((g) => (
          <div
            key={g.gate}
            role="row"
            className="block sm:table-row mb-4 sm:mb-0 rounded-[1.5rem] sm:rounded-none border-[3px] sm:border-0 sm:border-t-[3px] border-ink bg-paper sm:bg-transparent p-4 sm:p-0 align-top"
          >
            <div role="cell" className="block sm:table-cell sm:p-3 font-extrabold align-top">{g.gate}</div>
            <div role="cell" className="block sm:table-cell sm:p-3 mt-2 sm:mt-0 align-top">{g.question}</div>
            <div role="cell" className="block sm:table-cell sm:p-3 mt-2 sm:mt-0 align-top">
              <span className={`inline-block rounded-full border-2 border-ink px-3 py-0.5 font-extrabold text-ink ${CHIP[g.verdict]}`}>
                {g.verdict === "OTHER" ? "NOTE" : g.verdict}
              </span>{" "}
              <Cell text={g.verdict === "OTHER" ? g.result : g.result.replace(LEAD, "")} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

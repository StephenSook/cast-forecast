import Link from "next/link";
import type { Bottle } from "@/lib/catalogue";

const CHIP =
  "rounded-full border-2 border-ink px-4 py-2.5 min-h-11 max-w-full break-words text-left font-bold shadow-[0_2px_0_var(--ink)] transition-transform enabled:hover:-rotate-2 disabled:cursor-not-allowed disabled:opacity-70";

/**
 * One chip per bottle (chip style from Lullabuy src/ui/LiveCheck.tsx:104-110). The selected one is amber and
 * pressed. With no bottles there is nothing to pick, so it says so and points at the evidence.
 */
export function BottleChips({ bottles, selectedId, disabled, onPick }: {
  bottles: readonly Pick<Bottle, "id" | "name">[];
  selectedId: string | null;
  disabled: boolean;
  onPick(id: string): void;
}) {
  if (bottles.length === 0) {
    return (
      <p className="font-bold">
        No bottles yet.{" "}
        <Link href="/evidence" className="underline decoration-[3px] underline-offset-4 decoration-amber">
          Evidence
        </Link>
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {bottles.map((b) => {
        const selected = b.id === selectedId;
        return (
          <button
            key={b.id}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onPick(b.id)}
            className={`${CHIP} ${selected ? "bg-amber" : "bg-amber-soft enabled:hover:bg-amber"}`}
          >
            {b.name}
          </button>
        );
      })}
    </div>
  );
}

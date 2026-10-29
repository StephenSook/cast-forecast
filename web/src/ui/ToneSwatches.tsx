import type { Tone } from "@/lib/catalogue";

const SWATCH =
  "h-11 w-11 rounded-full border-2 border-ink shadow-[0_2px_0_var(--ink)] transition-transform enabled:hover:-rotate-6 disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:ring-4 aria-pressed:ring-amber aria-pressed:ring-offset-2";

/**
 * The shopper's skin tone: one swatch per tone the prediction covers, lighter first, plus "Deeper" for skin past the
 * study's range, which gets no prediction. Each swatch is named by its L*, since the colour alone is approximate.
 */
export function ToneSwatches({ tones, selected, disabled, onPick }: {
  tones: readonly Tone[];
  selected: number | "deeper" | null;
  disabled: boolean;
  onPick(tone: number | "deeper"): void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="font-bold">Closest to your skin</legend>
      <div className="flex flex-wrap items-center gap-3">
        {tones.map((t) => (
          <button
            key={t.lStar}
            type="button"
            aria-label={`Skin L* ${t.lStar}`}
            aria-pressed={selected === t.lStar}
            disabled={disabled}
            onClick={() => onPick(t.lStar)}
            className={SWATCH}
            style={{ backgroundColor: t.hex }}
          />
        ))}
        <button
          type="button"
          aria-pressed={selected === "deeper"}
          disabled={disabled}
          onClick={() => onPick("deeper")}
          className="rounded-full border-2 border-ink px-4 py-2.5 min-h-11 font-bold bg-paper shadow-[0_2px_0_var(--ink)] disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:bg-amber"
        >
          Deeper
        </button>
      </div>
    </fieldset>
  );
}

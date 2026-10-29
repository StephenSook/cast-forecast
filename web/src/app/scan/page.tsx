import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TONES } from "@/lib/catalogue";
import { scanEnabled } from "@/lib/flags";
import { readServerEnv } from "@/server/env";
import { LABELS, scanTarget } from "@/server/labels";
import { BarcodeCamera } from "@/ui/BarcodeCamera";

// Read at request time: the flag is an environment variable, not a build-time constant.
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");
// The radio is visually hidden; its swatch shows the choice (a ring) and the keyboard focus (globals.css .swatch-radio).
const SWATCH = "block h-11 w-11 rounded-full border-2 border-ink shadow-[0_2px_0_var(--ink)] peer-checked:ring-4 peer-checked:ring-amber peer-checked:ring-offset-2";

/**
 * In a store: pick your tone once, then scan (or type) the bottle's barcode, and its page opens on your tone. The form
 * is a plain GET, so it works without JavaScript; the barcode is looked up among the openFDA barcodes of every label.
 */
export default async function Scan({ searchParams }: PageProps<"/scan">) {
  if (!scanEnabled(LABELS, readServerEnv())) notFound();
  const sp = await searchParams;
  const tone = TONES.find((t) => String(t.lStar) === one(sp.tone))?.lStar ?? null;
  const code = one(sp.upc).trim();
  const target = code ? scanTarget(code, tone) : null;
  if (target) redirect(target);
  return (
    <section className="section-card bg-aqua-soft px-5 sm:px-12 pt-28 pb-16">
      <p className="hand text-3xl text-teal -rotate-2">scan a bottle in a store</p>
      <h1 className="display mt-9 text-[clamp(2.6rem,6vw,5.6rem)]">Scan</h1>
      <form action="/scan" method="get" className="mt-8 grid gap-6 max-w-[34rem]">
        <fieldset className="grid gap-2">
          <legend className="font-bold">Closest to your skin</legend>
          <div className="flex flex-wrap items-center gap-3">
            {TONES.map((t) => (
              <label key={t.lStar} className="cursor-pointer">
                <input type="radio" name="tone" value={t.lStar} defaultChecked={t.lStar === tone} className="peer sr-only swatch-radio" />
                <span className={SWATCH} style={{ backgroundColor: t.hex }} aria-hidden="true" />
                <span className="sr-only">Skin L* {t.lStar}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <BarcodeCamera inputName="upc" />
        <label className="grid gap-2 font-bold">
          Barcode number
          <input
            type="text"
            name="upc"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={code}
            maxLength={20}
            className="min-h-11 w-full rounded-full border-2 border-ink bg-paper px-4 font-bold tabular-nums"
          />
        </label>
        <button type="submit" className="justify-self-start rounded-full border-2 border-ink px-4 py-2.5 min-h-11 font-bold bg-amber shadow-[0_2px_0_var(--ink)]">
          Open
        </button>
      </form>
      {code && (
        <p role="alert" className="mt-6 max-w-[34rem] rounded-2xl border-2 border-ink bg-paper p-4 font-bold">
          No FDA label in the catalogue has that barcode.{" "}
          <Link href="/" className="underline decoration-[3px] underline-offset-4 decoration-amber">
            Find it by name
          </Link>
        </p>
      )}
    </section>
  );
}

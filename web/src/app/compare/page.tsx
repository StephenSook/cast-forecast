import type { Metadata } from "next";
import Link from "next/link";
import { TONES, whiteningDomain } from "@/lib/catalogue";
import { comparePage } from "@/lib/compare";
import { foldText } from "@/lib/search";
import { LABELS } from "@/server/labels";
import { Bars, barsProblem } from "@/ui/Bars";
import { ChartGuard } from "@/ui/DataUnavailable";

export const metadata: Metadata = { title: "Compare | Cast Forecast" };

/** The tone /compare opens on: the middle one, where one number per bottle is shown elsewhere. */
const DEFAULT_TONE = 55;
const SWATCH = "block h-11 w-11 rounded-full border-2 border-ink shadow-[0_2px_0_var(--ink)] aria-[current=true]:ring-4 aria-[current=true]:ring-amber aria-[current=true]:ring-offset-2";
const LINK = "font-extrabold underline decoration-[3px] underline-offset-4 decoration-amber";

const one = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");

/** A /compare address; empty values are left out. */
function href(tone: number, q: string, page = 1): string {
  const p = new URLSearchParams({ tone: String(tone) });
  if (q) p.set("q", q);
  if (page > 1) p.set("page", String(page));
  return `/compare?${p}`;
}

export default async function Compare({ searchParams }: PageProps<"/compare">) {
  const sp = await searchParams;
  const tone = TONES.find((t) => String(t.lStar) === one(sp.tone))?.lStar ?? DEFAULT_TONE;
  const q = one(sp.q).trim().slice(0, 60);
  // comparePage lists everything for a query with nothing to match ("%%"), so the sentence must not say "matching".
  const searched = foldText(q) !== "";
  const r = comparePage(LABELS, tone, q, Number(one(sp.page)));
  const domain = whiteningDomain(LABELS);
  const chartProblem = r.problem ?? barsProblem(r.rows, domain);
  return (
    <section className="section-card bg-aqua-soft px-5 sm:px-12 pt-28 pb-16">
      <p className="hand text-3xl text-teal -rotate-2">same face, every bottle</p>
      <h1 className="display mt-9 text-[clamp(2.6rem,6vw,5.6rem)]">Compare</h1>
      {LABELS.length === 0 ? (
        <p className="mt-8 text-xl font-bold">No bottles yet.</p>
      ) : (
        <div className="mt-8 max-w-4xl grid gap-6">
          <form action="/compare" method="get" role="search" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="tone" value={tone} />
            <label className="grid gap-2 font-bold min-w-0 grow sm:grow-0">
              Find your sunscreen
              <input
                type="search"
                name="q"
                defaultValue={q}
                maxLength={60}
                autoComplete="off"
                className="min-h-11 w-full sm:w-80 rounded-full border-2 border-ink bg-paper px-4 font-bold"
              />
            </label>
            <button type="submit" className="rounded-full border-2 border-ink px-4 py-2.5 min-h-11 font-bold bg-amber shadow-[0_2px_0_var(--ink)]">
              Search
            </button>
          </form>
          <nav aria-label="Skin tone" className="grid gap-2">
            <p className="font-bold">Closest to your skin</p>
            <ul className="flex flex-wrap items-center gap-3">
              {TONES.map((t) => (
                <li key={t.lStar}>
                  <Link href={href(t.lStar, q)} aria-label={`Skin L* ${t.lStar}`} aria-current={t.lStar === tone ? "true" : undefined} className={SWATCH} style={{ backgroundColor: t.hex }} />
                </li>
              ))}
            </ul>
          </nav>
          {r.total === 0 ? (
            <p className="text-xl font-bold">No bottle by that name.</p>
          ) : (
            <div>
              {r.unit && !chartProblem && (
                <p className="mb-3 font-bold">
                  Predicted whitening on skin of L* {tone}, in {r.unit}, from {r.total} FDA labels{searched ? " matching your search" : ""}. Least cast first.
                </p>
              )}
              <ChartGuard problem={chartProblem} what="predicted whitening by bottle">
                <Bars rows={r.rows} domain={domain} format={(v) => v.toFixed(1)} ariaLabel="Predicted whitening by bottle" />
              </ChartGuard>
            </div>
          )}
          {r.pages > 1 && (
            <nav aria-label="Pages" className="flex flex-wrap items-center gap-x-6 gap-y-2 font-bold">
              {r.page > 1 && (
                <Link href={href(tone, q, r.page - 1)} className={LINK} rel="prev">
                  Previous
                </Link>
              )}
              <span aria-current="page">
                Page {r.page} of {r.pages}
              </span>
              {r.page < r.pages && (
                <Link href={href(tone, q, r.page + 1)} className={LINK} rel="next">
                  Next
                </Link>
              )}
            </nav>
          )}
        </div>
      )}
    </section>
  );
}

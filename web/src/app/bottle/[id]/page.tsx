import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatValue, labelUrl, toneOf, whiteningDomain } from "@/lib/catalogue";
import { evidenceLine } from "@/lib/compare";
import { LABELS, findLabel } from "@/server/labels";
import { Bars } from "@/ui/Bars";
import { ResultBlock } from "@/ui/ResultBlock";
import { SquashButton } from "@/ui/SquashButton";

// Rendered per request (it reads ?tone=), for every label in the catalogue; an unknown id is 404.
export async function generateMetadata({ params }: PageProps<"/bottle/[id]">): Promise<Metadata> {
  const bottle = findLabel((await params).id);
  return { title: bottle ? `${bottle.name} | Cast Forecast` : "Cast Forecast" };
}

/**
 * One bottle: the predicted cast from its FDA label, by skin tone. `?tone=` (one of the catalogue's tones, as the scan
 * page sends it) puts that tone's number on top; otherwise it is the L* 55 one.
 */
export default async function BottlePage({ params, searchParams }: PageProps<"/bottle/[id]">) {
  const bottle = findLabel((await params).id);
  if (!bottle) notFound();
  const asked = (await searchParams).tone;
  const tone = typeof asked === "string" && /^\d{2}$/.test(asked) ? toneOf(bottle, Number(asked)) : undefined;
  const tryHref = `/?${new URLSearchParams({ bottle: bottle.id, ...(tone ? { tone: String(tone.lStar) } : {}) })}`;
  return (
    <section className="section-card bg-aqua-soft px-5 sm:px-12 pt-28 pb-16">
      <p className="hand text-3xl text-teal -rotate-2">{bottle.evidence.zincOxidePct}% zinc oxide</p>
      <h1 className="display mt-9 text-[clamp(2.6rem,6vw,5.6rem)]">{bottle.name}</h1>
      <div className="mt-8">
        <ResultBlock word={formatValue((tone ?? bottle).whitening)} line={evidenceLine(bottle, tone?.lStar)} tone="amber" />
      </div>
      <div className="mt-8 max-w-[44rem]">
        <p className="mb-3 font-bold">By skin tone, lighter to deeper.</p>
        <Bars
          rows={bottle.tones.map((t) => ({ label: `Skin L* ${t.lStar}`, value: t.whitening.value, low: t.whitening.low, high: t.whitening.high }))}
          domain={whiteningDomain(LABELS)}
          format={(v) => formatValue({ value: v, unit: bottle.whitening.unit })}
          ariaLabel="Predicted whitening by skin tone"
        />
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
        <SquashButton href={tryHref}>Try it on me</SquashButton>
        <Link href="/evidence" className="font-extrabold underline decoration-[3px] underline-offset-4 decoration-amber">
          See the evidence
        </Link>
        <a href={labelUrl(bottle)} target="_blank" rel="noreferrer" className="font-extrabold underline decoration-[3px] underline-offset-4 decoration-amber">
          Read the FDA label<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </section>
  );
}

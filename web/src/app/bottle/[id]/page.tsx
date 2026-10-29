import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CATALOGUE, findBottle, formatValue, formatWhitening, labelUrl, whiteningDomain } from "@/lib/catalogue";
import { evidenceLine } from "@/lib/compare";
import { Bars } from "@/ui/Bars";
import { ResultBlock } from "@/ui/ResultBlock";
import { SquashButton } from "@/ui/SquashButton";

export const dynamicParams = false;

export function generateStaticParams() {
  return CATALOGUE.map((b) => ({ id: b.id }));
}

export async function generateMetadata({ params }: PageProps<"/bottle/[id]">): Promise<Metadata> {
  const bottle = findBottle((await params).id);
  return { title: bottle ? `${bottle.name} | Cast Forecast` : "Cast Forecast" };
}

export default async function BottlePage({ params }: PageProps<"/bottle/[id]">) {
  const bottle = findBottle((await params).id);
  if (!bottle) notFound();
  return (
    <section className="section-card bg-aqua-soft px-5 sm:px-12 pt-28 pb-16">
      <p className="hand text-3xl text-teal -rotate-2">{bottle.evidence.zincOxidePct}% zinc oxide</p>
      <h1 className="display mt-9 text-[clamp(2.6rem,6vw,5.6rem)]">{bottle.name}</h1>
      <div className="mt-8">
        <ResultBlock
          word={formatWhitening(bottle)}
          line={evidenceLine(bottle)}
          tone="amber"
        />
      </div>
      <div className="mt-8 max-w-[44rem]">
        <p className="mb-3 font-bold">By skin tone, lighter to deeper.</p>
        <Bars
          rows={bottle.tones.map((t) => ({ label: `Skin L* ${t.lStar}`, value: t.whitening.value, low: t.whitening.low, high: t.whitening.high }))}
          domain={whiteningDomain(CATALOGUE)}
          format={(v) => formatValue({ value: v, unit: bottle.whitening.unit })}
          ariaLabel="Predicted whitening by skin tone"
        />
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
        <SquashButton href={`/?bottle=${encodeURIComponent(bottle.id)}`}>Try it on me</SquashButton>
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

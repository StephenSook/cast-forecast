import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CATALOGUE, findBottle, formatWhitening } from "@/lib/catalogue";
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
  const { whitening, evidence } = bottle;
  return (
    <section className="section-card bg-aqua-soft px-5 sm:px-12 pt-28 pb-16">
      <p className="hand text-3xl text-teal -rotate-2">{bottle.brand}</p>
      <h1 className="display mt-9 text-[clamp(2.6rem,6vw,5.6rem)]">{bottle.name}</h1>
      <div className="mt-8">
        <ResultBlock
          word={formatWhitening(bottle)}
          line={`Range ${whitening.low.toFixed(1)} to ${whitening.high.toFixed(1)} ${whitening.unit}, from ${evidence.photos} photos measured ${evidence.measuredAt}.`}
          tone="amber"
        />
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
        <SquashButton href={`/?bottle=${encodeURIComponent(bottle.id)}`}>Try it on me</SquashButton>
        <Link href="/evidence" className="font-extrabold underline decoration-[3px] underline-offset-4 decoration-amber">
          See the evidence
        </Link>
      </div>
    </section>
  );
}

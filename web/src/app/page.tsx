import { CATALOGUE, TONES, whiteningDomain } from "@/lib/catalogue";
import { bottleFromParam } from "@/lib/tryFlow";
import { LABELS, findLabel } from "@/server/labels";
import { TryFlow } from "@/ui/TryFlow";

export default async function Home({ searchParams }: PageProps<"/">) {
  const { bottle, tone } = await searchParams;
  // `?bottle=` may name any label (a bottle page's "Try it on me"); a label that is not a chip is handed to the flow.
  const id = bottleFromParam(bottle, LABELS);
  const initial = id && !CATALOGUE.some((b) => b.id === id) ? findLabel(id) : undefined;
  const initialTone = TONES.find((t) => typeof tone === "string" && String(t.lStar) === tone)?.lStar ?? null;
  return (
    <section className="section-card bg-aqua-soft px-5 sm:px-12 pt-28 pb-16">
      <p className="hand text-3xl text-teal -rotate-2">see the cast before you buy</p>
      <h1 className="display mt-9 text-[clamp(2.6rem,6vw,5.6rem)]">Try it on</h1>
      <TryFlow bottles={CATALOGUE} domain={whiteningDomain(LABELS)} initialBottleId={id} initialBottle={initial} initialTone={initialTone} />
    </section>
  );
}

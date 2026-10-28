import { CATALOGUE } from "@/lib/catalogue";
import { bottleFromParam } from "@/lib/tryFlow";
import { TryFlow } from "@/ui/TryFlow";

export default async function Home({ searchParams }: PageProps<"/">) {
  const { bottle } = await searchParams;
  return (
    <section className="section-card bg-aqua-soft px-5 sm:px-12 pt-28 pb-16">
      <p className="hand text-3xl text-teal -rotate-2">see the cast before you buy</p>
      <h1 className="display mt-4 text-[clamp(2.6rem,6vw,5.6rem)]">Try it on</h1>
      <TryFlow bottles={CATALOGUE} initialBottleId={bottleFromParam(bottle)} />
    </section>
  );
}

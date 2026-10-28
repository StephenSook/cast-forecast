import { notFound } from "next/navigation";
import { CATALOGUE } from "@/lib/catalogue";
import { scanEnabled } from "@/lib/flags";
import { readServerEnv } from "@/server/env";

// Read at request time: the flag is an environment variable, not a build-time constant.
export const dynamic = "force-dynamic";

export default function Scan() {
  if (!scanEnabled(CATALOGUE, readServerEnv())) notFound();
  return (
    <section className="section-card bg-aqua-soft px-5 sm:px-12 pt-28 pb-16">
      <p className="hand text-3xl text-teal -rotate-2">scan a bottle in a store</p>
      <h1 className="display mt-9 text-[clamp(2.6rem,6vw,5.6rem)]">Scan</h1>
      <p className="mt-8 text-xl font-bold">Barcode scanning is not built yet.</p>
    </section>
  );
}

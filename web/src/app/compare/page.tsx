import type { Metadata } from "next";
import { CATALOGUE, whiteningDomain } from "@/lib/catalogue";
import { compareRows } from "@/lib/compare";
import { Bars, barsProblem } from "@/ui/Bars";
import { ChartGuard } from "@/ui/DataUnavailable";

export const metadata: Metadata = { title: "Compare | Cast Forecast" };

export default function Compare() {
  const { rows, unit, problem } = compareRows(CATALOGUE);
  const domain = whiteningDomain(CATALOGUE);
  const chartProblem = problem ?? barsProblem(rows, domain);
  return (
    <section className="section-card bg-aqua-soft px-5 sm:px-12 pt-28 pb-16">
      <p className="hand text-3xl text-teal -rotate-2">same face, every bottle</p>
      <h1 className="display mt-9 text-[clamp(2.6rem,6vw,5.6rem)]">Compare</h1>
      {rows.length === 0 ? (
        <p className="mt-8 text-xl font-bold">No bottles measured yet.</p>
      ) : (
        <div className="mt-8 max-w-4xl">
          {unit && !chartProblem && <p className="mb-3 font-bold">Measured whitening, in {unit}.</p>}
          <ChartGuard problem={chartProblem} what="measured whitening by bottle">
            <Bars rows={rows} domain={domain} format={(v) => v.toFixed(1)} ariaLabel="Measured whitening by bottle" />
          </ChartGuard>
        </div>
      )}
    </section>
  );
}

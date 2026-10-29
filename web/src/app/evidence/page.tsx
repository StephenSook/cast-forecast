import type { Metadata } from "next";
import { headers } from "next/headers";
import { RENDER_MAX_ERROR_L } from "@/lib/catalogue";
import { CURVE_Y_MAX, curveLabel, curvePoints, evidenceSteps, evidenceTiles, factLine, leftOutLine, originFrom } from "@/lib/evidence";
import { K1B, loadGates } from "@/lib/gates";
import { RELEASE } from "@/lib/release";
import { LABELS, LEFT_OUT } from "@/server/labels";
import { CurveChart, curveProblem } from "@/ui/CurveChart";
import { ChartGuard } from "@/ui/DataUnavailable";
import { GateTable } from "@/ui/GateTable";
import { JudgeSteps } from "@/ui/JudgeSteps";
import { StatTile } from "@/ui/StatTile";

export const metadata: Metadata = { title: "Evidence | Cast Forecast" };

const TONES = ["paper", "amber", "aqua", "paper"] as const;

// Reads the request's origin for the printed curl, so the page is rendered per request.
export default async function Evidence() {
  const origin = originFrom(await headers());
  const gates = loadGates();
  const points = curvePoints(K1B);
  return (
    <section className="section-card bg-sand px-5 sm:px-12 pt-28 pb-16">
      <p className="hand text-3xl text-teal -rotate-2">no login, no key, every number sourced</p>
      <h1 className="display mt-9 text-[clamp(2.6rem,6vw,5.6rem)]">Evidence</h1>
      <p className="mt-4 font-bold">{factLine(LABELS.length, gates.length, RELEASE)}</p>
      <p className="mt-2 max-w-3xl text-sm font-bold">{leftOutLine(LEFT_OUT, RENDER_MAX_ERROR_L)}</p>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {evidenceTiles(K1B).map((t, i) => (
          <StatTile key={t.label} value={t.value} label={t.label} tone={TONES[i]} />
        ))}
      </div>

      <div className="mt-8 max-w-3xl rounded-[2rem] border-[3px] border-ink bg-paper p-5">
        <ChartGuard problem={curveProblem(points, CURVE_Y_MAX)} what="the K1b blend strength curve">
          <CurveChart points={points} yMax={CURVE_Y_MAX} xLabel="colorIntensity" title="K1b blend strength by colorIntensity" yLabel="blend strength" ariaLabel={curveLabel(K1B)} />
        </ChartGuard>
      </div>

      <GateTable gates={gates} />

      <div className="mt-10">
        <JudgeSteps steps={evidenceSteps(origin, LABELS.length)} />
      </div>

      <p className="mt-8 max-w-3xl text-sm font-bold">
        Read from docs/gates in the repo at release {RELEASE.slice(0, 7)}. K1b used one person and one lighting condition. It tests
        YouCam&apos;s renderer, not any sunscreen.
      </p>
    </section>
  );
}

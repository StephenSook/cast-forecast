import { githubDocUrl, type K1bSummary } from "@/lib/gates";
import { siteUrl } from "@/lib/site";
import type { JudgeStep } from "@/ui/JudgeSteps";

const REPO = "https://github.com/StephenSook/cast-forecast";

/** The study table behind the predictions and the pinned FDA labels, on GitHub. */
export const DATA_URL = `${REPO}/tree/main/data`;

/** The four K1b numbers on /evidence. Every figure, the render count and the dE00 bar included, comes from `k`. */
export function evidenceTiles(k: K1bSummary): { value: string; label: string }[] {
  return [
    { value: k.r2.toFixed(3), label: `blend model fit (R squared, ${k.nFitted} renders)` },
    { value: k.inverseGatingDe00.toFixed(2), label: `dE00 to target on a second selfie (bar ${k.inverseDeMax.toFixed(1)})` },
    { value: k.g100.toFixed(3), label: "blend strength at colorIntensity 100" },
    { value: String(k.unitsSpent), label: "API units spent on K1b" },
  ];
}

/** The numbered "check it yourself" cards. `base` is the site origin the printed curl points at. */
export function evidenceSteps(base: string, bottles: number): JudgeStep[] {
  const data: JudgeStep = {
    title: "The data",
    body: `The 13-volunteer study table every prediction is fitted on (CC BY 4.0), and the FDA label behind each of the ${bottles} bottles.`,
    href: DATA_URL,
    cta: "data/ on GitHub",
    external: true,
  };
  return [
    {
      title: "Read the gates",
      body: "Each gate has a written pass rule, and every result stays, pass or fail. Gate 1's page notes what was looked at before its rule was written.",
      href: githubDocUrl("README.md"),
      cta: "docs/gates on GitHub",
      external: true,
    },
    {
      title: "Check the prediction",
      body: "Refits the label model from the study table and recomputes Gate 1's held-out error.",
      code: `curl -s ${base}/api/label-model`,
    },
    { title: "Check the render mapping", body: "Recomputes the K1b inverse from the published curve.", code: `curl -s ${base}/api/gates` },
    data,
    {
      title: "Read the code",
      body: "Lint, types, tests, build and a bundle scan run on every push.",
      href: REPO,
      cta: "StephenSook/cast-forecast",
      external: true,
    },
  ];
}

/** One line of counts for the evidence page. */
export function factLine(bottles: number, gates: number, release: string): string {
  return `Bottles: ${bottles}. Gates on record: ${gates}. Release ${release.slice(0, 7)}.`;
}

/** The labels the catalogue leaves out and why, every count read from the data (data/bottles/README.md has the rules). */
export function leftOutLine(n: { tinted: number; powder: number; lip: number; render_error: number }, maxErrorL: number): string {
  return `Not predicted: tinted (${n.tinted}), powders (${n.powder}), lip products (${n.lip}), and any render more than ${maxErrorL} L* off its prediction (${n.render_error}).`;
}

/** The pinned y axis of the K1b chart (blend strength). A curve above it shows the "data unavailable" card. */
export const CURVE_Y_MAX = 0.4;

export function curvePoints(k: K1bSummary): { x: number; y: number }[] {
  return [...k.g.entries()].map(([x, y]) => ({ x, y }));
}

/** Names the last point from the data, so the label can never drift from the bars. */
export function curveLabel(k: K1bSummary): string {
  const last = curvePoints(k).at(-1);
  return last ? `K1b blend strength by colorIntensity: ${last.y.toFixed(3)} at ${last.x}` : "K1b blend strength by colorIntensity";
}

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Splits a gates-table cell into plain text and markdown links; a relative link resolves to docs/gates on GitHub. */
export function cellParts(cell: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  let at = 0;
  for (const m of cell.matchAll(LINK)) {
    if (m.index > at) out.push({ text: cell.slice(at, m.index) });
    out.push({ text: m[1], href: /^[a-z][a-z0-9+.-]*:/i.test(m[2]) ? m[2] : githubDocUrl(m[2]) });
    at = m.index + m[0].length;
  }
  if (at < cell.length) out.push({ text: cell.slice(at) });
  return out;
}

/**
 * The site origin for the printed curl: forwarded headers first (behind a proxy), then Host, else the configured
 * site URL. A malformed value falls back rather than being printed.
 */
export function originFrom(h: { get(name: string): string | null }): string {
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  const proto = first(h.get("x-forwarded-proto"));
  const host = first(h.get("x-forwarded-host")) ?? first(h.get("host"));
  if (!host || !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return siteUrl();
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

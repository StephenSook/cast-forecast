import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

// Names and values that must never appear in code shipped to the browser.
export const FORBIDDEN = ["YOUCAM_API_KEY", "SESSION_SECRET", "CREDIT_FLOOR", "Bearer", "yce-api-01.makeupar.com", "s2s/v2.0"] as const;

/** Recursively reads every file under `dir` with an extension in `exts` and reports each needle found. Throws if `dir` is missing. */
export function scanForNeedles(
  dir: string,
  needles: readonly string[],
  exts: readonly string[] = [".js", ".css", ".html", ".json", ".map"],
): { files: number; hits: { file: string; needle: string }[] } {
  const hits: { file: string; needle: string }[] = [];
  let files = 0;
  const visit = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) visit(p);
      else if (exts.includes(extname(p))) {
        files += 1;
        const text = readFileSync(p, "utf8");
        for (const needle of needles) if (text.includes(needle)) hits.push({ file: p, needle });
      }
    }
  };
  visit(dir); // readdirSync throws ENOENT on a missing directory
  return { files, hits };
}

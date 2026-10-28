import { readdirSync } from "node:fs";
import { extname, join } from "node:path";

type Rule = { name: string; re: RegExp };

// Dashes are written as escapes so this file never contains the characters it bans.
const RULES: Rule[] = [
  { name: "em-dash", re: /\u2014/ },
  { name: "en-dash", re: /\u2013/ },
  { name: "sun claim", re: /\b(spf|sunburn|broad spectrum)\b/i },
  { name: "protection claim", re: /\bprotect(s|ion|ive)?\b/i },
  { name: "safety claim", re: /\bsafe(r|st|ty)?\b/i },
  { name: "use-less advice", re: /\b(use|apply|wear) less\b/i },
  { name: "use-less advice", re: /\bless product\b/i },
  { name: "low-contrast text class", re: /text-amber-deep/ },
  { name: "text opacity below 70", re: /\btext-(ink|paper)\/([1-9]|[1-6][0-9])\b/ },
  { name: "dropped token", re: /--visa|\b(bg|text)-pink\b/ },
];

// Paper text on a green or red fill fails 4.5:1. Checked per quoted string, in either order.
const FILL = /\bbg-(green|red)(?![\w-])/;
const PAPER_TEXT = /\btext-paper(?![\w-])/;
const QUOTED = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Returns one message per banned match in `text`, each naming the file, line, rule and match. */
export function findCopyViolations(text: string, file: string): string[] {
  const out: string[] = [];
  for (const { name, re } of RULES) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(global)) out.push(`${file}:${lineOf(text, m.index)}: ${name}: ${JSON.stringify(m[0])}`);
  }
  for (const m of text.matchAll(QUOTED)) {
    if (FILL.test(m[0]) && PAPER_TEXT.test(m[0])) {
      out.push(`${file}:${lineOf(text, m.index)}: paper text on a green or red fill: ${m[0]}`);
    }
  }
  return out;
}

/** Every file under `dir` (recursive, sorted) whose extension is in `exts`. */
export function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, exts));
    else if (entry.isFile() && exts.includes(extname(entry.name))) out.push(path);
  }
  return out.sort();
}

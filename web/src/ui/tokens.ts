/**
 * Color tokens from src/app/globals.css and the contrast rules the UI is held to.
 * tests/unit/tokens.test.ts reads the real stylesheet, so a hex edit that breaks a pair fails CI.
 */

export const TOKEN_NAMES = [
  "ink",
  "ink-soft",
  "paper",
  "sand",
  "amber",
  "amber-deep",
  "amber-soft",
  "green",
  "green-deep",
  "green-soft",
  "red",
  "red-deep",
  "red-soft",
  "aqua",
  "aqua-soft",
  "teal",
  "focus",
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

/** Reads every token's 6-digit hex from the `:root` block. Throws when one is missing. */
export function readTokens(css: string): Record<TokenName, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(css);
  if (!root) throw new Error("no :root block in the stylesheet");
  const out = {} as Record<TokenName, string>;
  for (const name of TOKEN_NAMES) {
    const m = new RegExp(`(?:^|[\\s;])--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(root[1]);
    if (!m) throw new Error(`token --${name} is missing or not a 6-digit hex`);
    out[name] = m[1].toLowerCase();
  }
  return out;
}

function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a 6-digit hex: ${hex}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function linear(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: readonly number[]): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * WCAG 2 contrast ratio of `fg` drawn at `alpha` over `bg`. The foreground is blended over the
 * background first, rounding each channel to an integer as a browser does, then compared with `bg`.
 */
export function contrast(t: Record<TokenName, string>, fg: TokenName, bg: TokenName, alpha = 1): number {
  if (!(alpha >= 0 && alpha <= 1)) throw new Error(`alpha must be between 0 and 1, got ${alpha}`);
  const f = rgb(t[fg]);
  const b = rgb(t[bg]);
  const blended = f.map((c, i) => Math.round(alpha * c + (1 - alpha) * b[i]));
  const l1 = luminance(blended);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Every text color allowed on every fill, as [text, fill, opacity?]. Each must reach 4.5:1. */
export const TEXT_ON_FILL: ReadonlyArray<readonly [TokenName, TokenName, number?]> = [
  ["ink", "paper"],
  ["ink", "sand"],
  ["ink", "aqua-soft"],
  ["ink", "amber"],
  ["ink", "amber-soft"],
  ["ink", "aqua"],
  ["ink", "green"],
  ["ink", "amber-deep"],
  ["paper", "ink"],
  ["paper", "teal"],
  ["paper", "red-deep"],
  ["teal", "aqua-soft"],
  ["teal", "paper"],
  ["red-deep", "paper"],
  ["red-deep", "red-soft"],
  ["green-deep", "paper"],
  ["ink", "paper", 0.7],
  ["ink", "sand", 0.7],
  ["ink", "aqua-soft", 0.7],
  ["ink", "amber-soft", 0.7],
  ["paper", "ink", 0.7],
];

/** Focus outline color on each surface it can appear on, as [outline, surface]. Each must reach 3:1. */
export const FOCUS_ON_SURFACE: ReadonlyArray<readonly [TokenName, TokenName, number?]> = [
  ["focus", "paper"],
  ["focus", "sand"],
  ["focus", "aqua-soft"],
  ["focus", "amber-soft"],
  ["amber", "ink"],
];

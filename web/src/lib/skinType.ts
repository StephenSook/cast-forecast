/** Fitzpatrick skin types as YouCam's AI Fitzpatrick Skin Type Analysis returns them (ai_fitzpatrick_skin_type.yaml:484-496). */
export const FITZPATRICK = ["I", "II", "III", "IV", "V", "VI"] as const;
export type Fitzpatrick = (typeof FITZPATRICK)[number];

export function isFitzpatrick(v: unknown): v is Fitzpatrick {
  return typeof v === "string" && (FITZPATRICK as readonly string[]).includes(v);
}

/**
 * The tone suggested for each type: a starting point the shopper confirms or changes, never a measurement. A type
 * describes how skin burns and tans, not its colour, so each is paired in order with an ITA° colour class (very light,
 * light, intermediate, tan, brown, dark; Del Bino et al. 2006, PMID 17083487, which ties those classes to UV response).
 * A type gets a tone whose ITA° at the tones' b* of 18 lies in its class, the deeper one when two do, so the predicted
 * cast is never understated. The two light classes lie above the lightest tone, which they get. Dark lies below the
 * study's range, so type VI gets no prediction. tests/unit/skinType.test.ts derives this table from those rules.
 */
export const SUGGESTED_TONE: Readonly<Record<Fitzpatrick, number | "deeper">> = Object.freeze({
  I: 65,
  II: 65,
  III: 60,
  IV: 55,
  V: 45,
  VI: "deeper",
});

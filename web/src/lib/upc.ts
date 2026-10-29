/**
 * Barcodes as one comparable form: GTIN-13, the 13 digits openFDA lists (a UPC-A with a leading zero).
 * A 12-digit UPC-A gains that zero, a GTIN-14 whose first digit is 0 loses one, and an 8-digit UPC-E (small packs,
 * sticks) is expanded to its UPC-A first. A wrong check digit (a mistyped number) or all zeros (a placeholder some
 * labels list) is not a barcode, and neither is anything else: null.
 */
export function normalizeUpc(raw: string): string | null {
  const s = raw.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(s)) return null;
  let code: string | null = null;
  if (s.length === 13) code = s;
  else if (s.length === 12) code = `0${s}`;
  else if (s.length === 14 && s.startsWith("0")) code = s.slice(1);
  else if (s.length === 8) {
    const a = upcEToA(s);
    code = a ? `0${a}` : null;
  }
  return code && checkDigitOk(code) && /[1-9]/.test(code) ? code : null;
}

/** The GTIN check: digits weighted 3, 1, 3, ... from the right (check digit excluded) sum with it to a multiple of 10. */
export function checkDigitOk(code: string): boolean {
  let sum = 0;
  for (let i = code.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += Number(code[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
}

/** UPC-E (number system 0 or 1, six digits, check digit) to its 12-digit UPC-A, or null for another number system. */
export function upcEToA(e: string): string | null {
  if (!/^[01]\d{7}$/.test(e)) return null;
  const [ns, d, check] = [e[0], e.slice(1, 7), e[7]];
  const last = d[5];
  let body: string;
  if (last <= "2") body = `${d[0]}${d[1]}${last}0000${d[2]}${d[3]}${d[4]}`;
  else if (last === "3") body = `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`;
  else if (last === "4") body = `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`;
  else body = `${d.slice(0, 5)}0000${last}`;
  return `${ns}${body}${check}`;
}

/**
 * Every normalized barcode to the id of the one entry that lists it. A barcode listed by more than one entry opens
 * nothing: the labels do not say which product it belongs to (openFDA lists barcodes per label, not per package), and
 * opening the wrong formulation's prediction and label is worse than asking the shopper to search by name.
 */
export function upcIndex(entries: readonly { id: string; upcs?: readonly string[]; upc: string | null }[]): Map<string, string> {
  const listers = new Map<string, Set<string>>();
  for (const e of entries) {
    for (const raw of [...(e.upcs ?? []), ...(e.upc ? [e.upc] : [])]) {
      const code = normalizeUpc(raw);
      if (code) listers.set(code, (listers.get(code) ?? new Set()).add(e.id));
    }
  }
  const index = new Map<string, string>();
  for (const [code, ids] of listers) if (ids.size === 1) index.set(code, [...ids][0]);
  return index;
}

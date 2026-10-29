"use client";

import { useRef, useState, useSyncExternalStore } from "react";

// The Barcode Detection API (Chrome on Android, among others). Not in TypeScript's DOM library, so declared here.
type Detector = { detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]> };
type DetectorClass = new (options: { formats: string[] }) => Detector;

const FORMATS = ["upc_a", "upc_e", "ean_13", "ean_8"];

const noSubscribe = () => () => {};

function detectorClass(): DetectorClass | null {
  const c = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  return typeof c === "function" ? c : null;
}

/**
 * "Scan the barcode": where the browser can read barcodes, a photo of the bottle's barcode is read on the device (the
 * photo never leaves it), its number is put in `inputName` of the surrounding form, and the form is sent. Elsewhere
 * nothing is shown, and the number is typed.
 */
export function BarcodeCamera({ inputName }: { inputName: string }) {
  // False on the server and in the first client render, so the page hydrates the same, then the browser's answer.
  const supported = useSyncExternalStore(noSubscribe, () => detectorClass() !== null, () => false);
  const [line, setLine] = useState("");
  const file = useRef<HTMLInputElement>(null);
  if (!supported) return null;

  const onFile = async (f: File | undefined) => {
    const Detector = detectorClass();
    const form = file.current?.form;
    if (!f || !Detector || !form) return;
    setLine("Reading the barcode.");
    try {
      const bitmap = await createImageBitmap(f);
      const codes = await new Detector({ formats: FORMATS }).detect(bitmap);
      bitmap.close();
      const code = codes.find((c) => /^\d{8,14}$/.test(c.rawValue))?.rawValue;
      const field = form.elements.namedItem(inputName);
      if (!code || !(field instanceof HTMLInputElement)) {
        setLine("No barcode found in that photo. Type the number under it.");
        return;
      }
      field.value = code;
      setLine("");
      form.requestSubmit();
    } catch {
      setLine("No barcode found in that photo. Type the number under it.");
    }
  };

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={() => file.current?.click()}
        className="justify-self-start rounded-full border-2 border-ink px-4 py-2.5 min-h-11 font-bold bg-paper shadow-[0_2px_0_var(--ink)]"
      >
        Scan the barcode
      </button>
      <input ref={file} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void onFile(e.target.files?.[0])} />
      <p role="status" className="font-bold min-h-[1.5em]">
        {line}
      </p>
    </div>
  );
}

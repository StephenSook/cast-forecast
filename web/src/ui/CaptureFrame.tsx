"use client";

import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ImageError, type PreparedImage, prepareImage, releaseImage } from "@/lib/image";
import type { CfErrorCode } from "@/lib/messages";
import { SquashButton } from "./SquashButton";

const ACCEPT = "image/jpeg,image/png";
const FILL = "absolute inset-0 w-full h-full object-contain";
const SECONDARY =
  "inline-flex h-[3em] items-center rounded-full border-[3px] border-ink bg-paper px-6 font-extrabold leading-none transition-colors enabled:hover:bg-amber-soft disabled:cursor-not-allowed disabled:opacity-50";

type Props = {
  image: PreparedImage | null;
  busy: boolean;
  onImage(i: PreparedImage): void;
  onError(c: CfErrorCode): void;
  prepare?: (f: File) => Promise<PreparedImage>;
  resultUrl?: string | null;
  onResultError?: () => void;
  /** True when a picked photo starts being prepared, false when the newest one is handed on or refused. */
  onPreparing?: (preparing: boolean) => void;
  /** The render's image has loaded and is now on screen. */
  onResultLoad?: () => void;
  /** Loads the sample face; when given, a "Use a sample face" button sits beside Take a selfie and Upload. */
  onSample?: () => Promise<PreparedImage>;
  /** A short line under the frame while the render shows, such as the recorded render label. */
  resultNote?: string | null;
  /** Shown right under the picture and its label, above the photo buttons: the result, on narrow screens. */
  below?: ReactNode;
};

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

/**
 * The selfie frame (adapted from Lullabuy src/ui/PickupScanner.tsx:366-386): an ink frame that shows the selfie, then
 * the render, with a thin amber scan line while a request is in flight. Two inputs feed it: the front camera and a
 * file picker. Each photo is prepared in the browser, and only the newest one is handed on; one that loses the race
 * or arrives after the frame is gone has its preview URL freed. A render's image stays invisible, with the selfie and
 * the scan line still showing, until it has loaded, so the frame never goes blank while it downloads. Once it shows,
 * the selfie stays underneath and a slider splits the frame: the selfie (before) left of the line, the render (after)
 * right of it. Each new render starts at the middle. The sample face, when offered, is a third source that joins the
 * same race: the newest photo of any source wins.
 */
export function CaptureFrame({ image, busy, onImage, onError, prepare = prepareImage, resultUrl = null, onResultError, onPreparing, onResultLoad, onSample, resultNote = null, below = null }: Props) {
  const camera = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const newest = useRef(0);
  const mounted = useRef(true);
  const [preparing, setPreparing] = useState(false);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const shown = resultUrl !== null && loadedUrl === resultUrl;
  // The split belongs to one render: a new render URL starts at 50 without an effect.
  const [cut, setCut] = useState<{ url: string | null; at: number }>({ url: null, at: 50 });
  const at = cut.url === resultUrl ? cut.at : 50;
  const compare = shown && image !== null;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // `fallback` is the line for a failure that is not an ImageError: an undecodable photo, or a sample face that did not load.
  const take = async (load: () => Promise<PreparedImage>, fallback: CfErrorCode) => {
    const run = ++newest.current;
    setPreparing(true);
    onPreparing?.(true);
    let prepared: PreparedImage;
    try {
      prepared = await load();
    } catch (e) {
      if (!mounted.current || run !== newest.current) return;
      setPreparing(false);
      onPreparing?.(false);
      onError(e instanceof ImageError ? e.code : fallback);
      return;
    }
    if (!mounted.current || run !== newest.current) {
      releaseImage(prepared);
      return;
    }
    setPreparing(false);
    onPreparing?.(false);
    onImage(prepared);
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ""; // so picking the same file again still fires a change
    if (file) void take(() => prepare(file), "unsupported_image");
  };

  const off = busy || preparing;
  const who = image?.sample ? "The sample face" : "Your selfie";
  return (
    <div className="relative rounded-[2rem] bg-paper border-[3px] border-ink p-4 sm:p-6 min-w-0">
      <div data-testid="capture-frame" className="relative aspect-[3/4] rounded-2xl bg-ink overflow-hidden grid place-items-center">
        {image && !shown && (
          // eslint-disable-next-line @next/next/no-img-element -- a blob: URL that exists only in this tab
          <img data-testid="selfie-preview" src={image.url} alt={who} className={FILL} />
        )}
        {compare && (
          // eslint-disable-next-line @next/next/no-img-element -- a blob: URL that exists only in this tab
          <img data-testid="before-image" src={image.url} alt="" aria-hidden="true" className={FILL} />
        )}
        {resultUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived YouCam URL (or a recorded copy); nothing to optimise
          <img
            data-testid="result-image"
            src={resultUrl}
            alt={`${who} with the bottle's cast`}
            referrerPolicy="no-referrer"
            aria-hidden={shown ? undefined : true}
            onLoad={() => {
              setLoadedUrl(resultUrl);
              onResultLoad?.();
            }}
            onError={onResultError}
            className={shown ? FILL : `${FILL} opacity-0`}
            style={compare ? { clipPath: `inset(0 0 0 ${at}%)` } : undefined}
          />
        )}
        {compare && (
          <>
            <input
              data-testid="before-after"
              type="range"
              min={0}
              max={100}
              step={1}
              value={at}
              aria-label="Before and after"
              aria-valuetext={`Before ${at}%, after ${100 - at}%`}
              onChange={(e) => setCut({ url: resultUrl, at: Number(e.currentTarget.value) })}
              className="peer absolute inset-0 z-10 h-full w-full cursor-ew-resize opacity-0"
            />
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-[3px] -translate-x-1/2 bg-paper" style={{ left: `${at}%` }} />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-ink bg-paper peer-focus-visible:ring-4 peer-focus-visible:ring-amber"
              style={{ left: `${at}%` }}
            />
            {/* At the bottom corners: on a phone the floating nav covers the top of the frame whenever it is scrolled up
                to the top of the screen, which is exactly where these labels used to be. */}
            <span data-testid="before-label" aria-hidden="true" className="pointer-events-none absolute left-3 bottom-3 rounded-full bg-ink px-3 py-1 text-sm font-bold text-paper">
              Before
            </span>
            <span data-testid="after-label" aria-hidden="true" className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-ink px-3 py-1 text-sm font-bold text-paper">
              After
            </span>
          </>
        )}
        {!image && !resultUrl && (
          <svg role="img" aria-label="Selfie frame" viewBox="0 0 120 160" className="w-2/5 text-paper/70" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round">
            <path d="M10 34V14a4 4 0 0 1 4-4h20M86 10h20a4 4 0 0 1 4 4v20M110 126v20a4 4 0 0 1-4 4H86M34 150H14a4 4 0 0 1-4-4v-20" />
            <ellipse cx="60" cy="68" rx="24" ry="30" />
            <path d="M24 140c4-20 18-30 36-30s32 10 36 30" />
          </svg>
        )}
        {(busy || (resultUrl !== null && !shown)) && (
          <div
            data-testid="scan-line"
            aria-hidden="true"
            className="absolute inset-x-3 h-[2px] bg-amber shadow-[0_0_14px_3px_rgba(255,176,32,0.55)] animate-[scan_1.4s_ease-in-out_infinite]"
          />
        )}
      </div>
      {shown && resultNote && (
        // Right under the picture and inside its card, so the label travels with any capture of the frame, and the
        // picture's corners stay free for the Before and After labels.
        <p data-testid="result-note" className="mt-3 rounded-2xl bg-ink px-3 py-1.5 text-center text-sm font-bold text-paper">
          {resultNote}
        </p>
      )}
      {below}
      {/* Visually hidden, not display:none: some phone browsers ignore a programmatic click on a display:none file
          input. The buttons below are what people and screen readers use, so the inputs stay out of both. */}
      <input ref={camera} data-testid="camera-input" type="file" accept={ACCEPT} capture="user" disabled={off} tabIndex={-1} aria-hidden="true" className="sr-only" onChange={onChange} />
      <input ref={upload} data-testid="upload-input" type="file" accept={ACCEPT} disabled={off} tabIndex={-1} aria-hidden="true" className="sr-only" onChange={onChange} />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <SquashButton onClick={() => camera.current?.click()} disabled={off} icon={<CameraIcon />}>
          Take a selfie
        </SquashButton>
        <button type="button" onClick={() => upload.current?.click()} disabled={off} className={SECONDARY}>
          Upload
        </button>
        {onSample && (
          <button type="button" onClick={() => void take(onSample, "upstream")} disabled={off} className={SECONDARY}>
            Use a sample face
          </button>
        )}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiFailure, readSkinType, renderBottle, searchLabels, uploadSelfie } from "@/lib/apiClient";
import { type Bottle, TONES, type Tone, findBottle, formatValue, toneOf, whiteningDomain } from "@/lib/catalogue";
import { type PreparedImage, releaseImage } from "@/lib/image";
import { type CfErrorCode, MESSAGES } from "@/lib/messages";
import { SAMPLE, SAMPLE_LIVE_LINE, type Sample, loadSampleFace, recordedReadLine, recordedRenderLine, sampleRender } from "@/lib/sample";
import { type Fitzpatrick, SUGGESTED_TONE, toneWord } from "@/lib/skinType";
import { EXPIRED_LINE, type TryCode, type TryEvent, type TryState, canPick, canSuggest, initialTryState, tryReducer } from "@/lib/tryFlow";
import { Bars } from "./Bars";
import { BottleChips } from "./BottleChips";
import { BottleSearch } from "./BottleSearch";
import { CaptureFrame } from "./CaptureFrame";
import { prefersReducedMotion } from "./motion/gsap";
import { ResultBlock } from "./ResultBlock";
import { ToneSwatches } from "./ToneSwatches";

/** After this long in flight the status line says the wait can be long, and how long. */
const SLOW_MS = 10_000;
/** Keys that can scroll the page; pressing one while a render is in flight can be the shopper scrolling. */
const SCROLL_KEYS: ReadonlySet<string> = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
/** Text fields, selects and sliders, which use every scroll key themselves. Button-like inputs are not fields. */
const FIELD = "textarea, select, [contenteditable], input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox])";

/**
 * True when this key press scrolls the page itself rather than acting on the focused element: a scroll key that no
 * handler took (defaultPrevented, as the search list's arrows are), not pressed in a field or on a slider, and not Space
 * on a button or link (which presses it). PageDown, arrows, Home and End on a button do scroll the page, so they count.
 */
export function keyScrollsPage(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || !SCROLL_KEYS.has(e.key)) return false;
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest(FIELD)) return false;
  return !(e.key === " " && target?.closest("button, a[href], input, summary"));
}

/** Shown when the shopper's skin is deeper than any tone the study measured. */
export const DEEPER_LINE = "The study behind these numbers measured skin down to L* 44. Deeper skin has no prediction yet.";

type Api = { upload: typeof uploadSelfie; render: typeof renderBottle; readSkinType: typeof readSkinType; search?: typeof searchLabels };
const DEFAULT_API: Api = { upload: uploadSelfie, render: renderBottle, readSkinType, search: searchLabels };

/** The sample face: its recorded results and how to load its picture. */
export type SampleSource = { data: Sample; load: () => Promise<PreparedImage> };
const DEFAULT_SAMPLE: SampleSource = { data: SAMPLE, load: () => loadSampleFace(SAMPLE) };

function lineOf(code: TryCode): string {
  return code === "sample_live" ? SAMPLE_LIVE_LINE : MESSAGES[code];
}

/** The line under the tones once YouCam has read the selfie's skin type. It names the tone picked, so it is heard. */
export function suggestedLine(fitzpatrick: Fitzpatrick): string {
  return `YouCam reads Fitzpatrick type ${fitzpatrick}. We picked the closest tone (${toneWord(SUGGESTED_TONE[fitzpatrick])}); change it if it looks off.`;
}

/** On the sample face nothing is rendered or read live, so the wait is only the recorded image loading. */
function progressLine(phase: TryState["phase"], slow: boolean, sample = false): string {
  if (sample && phase === "rendering") return "Loading the recorded render.";
  if (phase === "uploading") return slow ? "Still sending. Up to a minute." : "Sending your selfie.";
  if (phase === "rendering") return slow ? "Still rendering. Up to 2 minutes." : "Rendering the cast.";
  if (phase === "reading") return slow ? "Still reading. Up to 2 minutes." : "Reading your skin type.";
  return "";
}

function failureOf(e: unknown): { code: CfErrorCode; message?: string } {
  if (e instanceof ApiFailure) return { code: e.code, message: e.message === MESSAGES[e.code] ? undefined : e.message };
  return { code: "upstream" };
}

/**
 * A wait clock: `start()` stamps the moment a request goes out (called from the tap), and while `busy` it ticks once
 * a second. `elapsed` is whole seconds since the stamp, or null when idle.
 */
function useWaitClock(busy: boolean): { elapsed: number | null; start(): void } {
  const [clock, setClock] = useState<{ since: number; now: number } | null>(null);
  useEffect(() => {
    if (!busy) return;
    const tick = setInterval(() => setClock((c) => (c ? { ...c, now: Date.now() } : c)), 1000);
    return () => clearInterval(tick);
  }, [busy]);
  const start = () => {
    const t = Date.now();
    setClock({ since: t, now: t });
  };
  return { elapsed: busy && clock ? Math.floor((clock.now - clock.since) / 1000) : null, start };
}

/**
 * The Try screen: a selfie, a tone (picked, or suggested from the selfie's skin type), a bottle chip, then the render.
 * The selfie leaves the browser only when a chip or the suggest button is tapped, and only through `api.upload`; later
 * steps reuse the uploaded file. Every transition goes through tryReducer
 * synchronously (a ref mirrors the state), so a double tap starts one render, and a newer photo or pick makes any
 * answer still in flight for an older one count for nothing. No pick starts while a new photo is being prepared, and
 * the result shows only once the render's image has loaded.
 *
 * The chips are the featured `bottles`. Any other label comes from the search field (or `initialBottle`, from a bottle
 * page's "Try it on me") and joins the chips as one more, picked the same way: the same reducer, render call and
 * server checks. `api.search` absent means no search field.
 *
 * The sample face (`sample`, null for none) is never sent anywhere: Suggest my tone shows its recorded skin type read,
 * a featured bottle shows its recorded render at the picked tone, each labelled as recorded, and any other label says
 * a live render needs the visitor's own selfie. None of it calls `api`, so it spends no unit.
 */
export function TryFlow({ bottles, tones = TONES, domain, initialBottleId = null, initialBottle = null, initialTone = null, api = DEFAULT_API, prepare, sample = DEFAULT_SAMPLE }: {
  bottles: readonly Bottle[];
  tones?: readonly Tone[];
  /** The result bar's axis; the whole catalogue's (whiteningDomain) so it matches /compare and the bottle pages. */
  domain?: readonly [number, number];
  initialBottleId?: string | null;
  initialBottle?: Bottle | null;
  initialTone?: number | null;
  api?: Api;
  prepare?: (f: File) => Promise<PreparedImage>;
  sample?: SampleSource | null;
}) {
  const [state, setState] = useState<TryState>(() => initialTryState(initialBottleId ?? initialBottle?.id ?? null, initialTone));
  // The one label picked from search (or handed in) that is not a chip; it shows as the last chip.
  const [found, setFound] = useState<Bottle | null>(initialBottle);
  const chips = found && !bottles.some((b) => b.id === found.id) ? [...bottles, found] : bottles;
  const live = useRef(state);
  const run = useRef(0);
  // A photo being prepared will replace the current one, so the chips are off meanwhile and no pick can start on the
  // old one. CaptureFrame reports it from inside the change event, and React re-renders before that event returns.
  const [preparing, setPreparing] = useState(false);
  // The render URL whose image has loaded; until then the frame keeps the selfie and the scan line.
  const [shownUrl, setShownUrl] = useState<string | null>(null);
  // Completed skin type reads; keys the announced line so each one is a new node in the live region.
  const [reads, setReads] = useState(0);

  const send = (e: TryEvent): TryState => {
    const next = tryReducer(live.current, e);
    if (next !== live.current) {
      live.current = next;
      setState(next);
    }
    return next;
  };

  // The preview URL is freed when a new photo replaces it and when the flow goes away.
  const imageUrl = state.image?.url;
  useEffect(() => {
    if (!imageUrl) return;
    return () => releaseImage({ url: imageUrl });
  }, [imageUrl]);
  // Nothing still in flight may act once the flow is gone.
  useEffect(() => () => void ++run.current, []);

  const busy = state.phase === "uploading" || state.phase === "rendering" || state.phase === "reading";
  const resultUrl = state.phase === "result" && state.result ? state.result.imageUrl : null;
  const revealed = resultUrl !== null && shownUrl === resultUrl;
  // Still waiting while the render's image downloads: the clock and the rendering line keep going until it shows.
  const waiting = busy || (resultUrl !== null && !revealed);
  const wait = useWaitClock(waiting);

  // Once a render shows, its number is brought into view if it is not fully on screen (on a phone it sits far below the
  // frame), by the least scroll that shows it, clear of the floating nav (scroll-mt), and with no animation under
  // reduced motion. A render already in view, as beside the frame on a wide screen, scrolls nothing. A live render can
  // take up to two minutes, so the page moves only if the shopper has not scrolled it themselves meanwhile: `scroll`
  // is armed by a pick and spent on its result, and any wheel, touch drag, page-scrolling key (keyScrollsPage) or
  // scrollbar press while a request is in flight cancels it. The page's own movement (it shortens when the old result
  // goes, and the browser clamps the scroll) is not the shopper's and cancels nothing. `picks` counts picks, so picking
  // the sample face's same bottle again, which lands the same recorded image in the same render, is checked again too.
  const resultRef = useRef<HTMLDivElement>(null);
  const scroll = useRef<{ armed: boolean; cancelled: boolean }>({ armed: false, cancelled: false });
  const [picks, setPicks] = useState(0);
  useEffect(() => {
    if (!waiting) return;
    const cancel = () => {
      scroll.current.cancelled = true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (keyScrollsPage(e)) cancel();
    };
    // A press on the page's own scrollbar lands on the root element.
    const onPress = (e: PointerEvent) => {
      if (e.target === document.documentElement) cancel();
    };
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchmove", cancel, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPress);
    return () => {
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchmove", cancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPress);
    };
  }, [waiting]);
  useEffect(() => {
    const el = resultRef.current;
    if (!revealed || !el || typeof el.scrollIntoView !== "function") return;
    const { armed, cancelled } = scroll.current;
    scroll.current = { armed: false, cancelled: false };
    if (!armed || cancelled) return;
    const clearOfNav = Number.parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    const box = el.getBoundingClientRect();
    if (box.top >= clearOfNav && box.bottom <= window.innerHeight) return;
    el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "nearest" });
  }, [revealed, resultUrl, picks]);

  const onImage = (image: PreparedImage) => {
    run.current++;
    send({ type: "PHOTO_READY", image });
  };
  const onImageError = (code: CfErrorCode) => {
    run.current++;
    send({ type: "FAILED", code });
  };

  const onPick = async (bottleId: string) => {
    const before = live.current;
    const picked = send({ type: "PICK", bottleId });
    if (picked === before || !picked.image || typeof picked.tone !== "number") return;
    const tone = picked.tone;
    wait.start();
    scroll.current = { armed: true, cancelled: false };
    setPicks((n) => n + 1);
    const mine = ++run.current;
    const current = () => mine === run.current;
    if (picked.image.sample) {
      // A recording, or the line that a live render needs the visitor's own selfie: no request either way.
      const recorded = sample ? sampleRender(sample.data, bottleId, tone) : null;
      send(recorded ? { type: "RENDERED", result: recorded } : { type: "FAILED", code: "sample_live" });
      return;
    }
    try {
      let fileId = picked.fileId;
      if (fileId === null) {
        const up = await api.upload(picked.image.blob);
        if (!current()) return;
        if (send({ type: "UPLOADED", fileId: up.fileId }).phase !== "rendering") return;
        fileId = up.fileId;
      }
      const result = await api.render(fileId, bottleId, tone);
      if (!current()) return;
      send({ type: "RENDERED", result });
    } catch (e) {
      if (current()) send({ type: "FAILED", ...failureOf(e) });
    }
  };

  // A search result is picked exactly like a chip; before a render can start, it is only marked picked.
  const onFound = (b: Bottle) => {
    if (!bottles.some((c) => c.id === b.id)) setFound(b);
    if (canPick(live.current) && !preparing) void onPick(b.id);
    else send({ type: "SELECT", bottleId: b.id });
  };

  // Every completed read counts, so the line re-announces even when it reads the same as the last one (a second
  // suggestion after the shopper changed the tone moves the tone back).
  const skinRead = (fitzpatrick: Fitzpatrick) => {
    const before = live.current;
    if (send({ type: "SKIN_READ", fitzpatrick }) !== before) setReads((n) => n + 1);
  };

  const onSuggest = async () => {
    const before = live.current;
    const started = send({ type: "READ_SKIN" });
    if (started === before || !started.image) return;
    wait.start();
    const mine = ++run.current;
    const current = () => mine === run.current;
    if (started.image.sample) {
      if (sample) skinRead(sample.data.skinType.fitzpatrick);
      else send({ type: "FAILED", code: "sample_live" });
      return;
    }
    try {
      let fileId = started.fileId;
      if (fileId === null) {
        const up = await api.upload(started.image.blob);
        if (!current()) return;
        if (send({ type: "UPLOADED", fileId: up.fileId }).phase !== "reading") return;
        fileId = up.fileId;
      }
      const read = await api.readSkinType(fileId);
      if (!current()) return;
      skinRead(read.fitzpatrick);
    } catch (e) {
      if (current()) send({ type: "FAILED", ...failureOf(e) });
    }
  };

  const line = state.phase === "error" && state.code ? (state.message ?? lineOf(state.code)) : state.expired ? EXPIRED_LINE : "";
  const onSample = sample !== null && state.image?.sample === true;
  const recordedOn = state.result?.recordedOn;
  const bottle = revealed && state.result ? findBottle(state.result.bottleId, chips) : undefined;
  const shown = bottle && typeof state.tone === "number" ? toneOf(bottle, state.tone) : undefined;
  const [lo, hi] = domain ?? whiteningDomain(chips);

  // One column on phones. From lg the frame sits left with the controls right and the result under them; from xl the
  // result gets its own column beside the controls, so the face and the number are on screen together at once. Where
  // the window is tall enough the frame stays in view while the page scrolls down to the result.
  return (
    <div className="mt-8 grid gap-6 items-start lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 lg:row-span-2 xl:row-span-1 lg:[@media(min-height:46rem)]:sticky lg:[@media(min-height:46rem)]:top-20">
        <CaptureFrame
          image={state.image}
          busy={busy}
          onImage={onImage}
          onError={onImageError}
          prepare={prepare}
          resultUrl={resultUrl}
          onResultError={() => send({ type: "IMAGE_EXPIRED" })}
          onResultLoad={() => setShownUrl(resultUrl)}
          onPreparing={setPreparing}
          onSample={sample && bottles.length > 0 ? sample.load : undefined}
          resultNote={recordedOn ? recordedRenderLine(recordedOn) : null}
        />
      </div>
      <div className="grid gap-4 min-w-0">
        {bottles.length > 0 && (
          <ToneSwatches tones={tones} selected={state.tone} disabled={busy || preparing} onPick={(tone) => send({ type: "TONE", tone })} />
        )}
        {bottles.length > 0 && (
          <button
            type="button"
            disabled={!canSuggest(state) || preparing}
            onClick={() => void onSuggest()}
            className="justify-self-start rounded-full border-2 border-ink px-4 py-2.5 min-h-11 font-bold bg-paper shadow-[0_2px_0_var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Suggest my tone
          </button>
        )}
        {bottles.length > 0 && (
          // Always mounted (a live region announces changes only once it exists), and out of the layout while empty, so
          // the suggested tone is read out whether it came from a live read or the sample face's recorded one. The line
          // is keyed by the read count, so each completed read inserts a new node and is announced even when the words
          // repeat.
          <p data-testid="skin-line" aria-live="polite" className={state.skinType ? "max-w-[34rem]" : "sr-only"}>
            {state.skinType && (
              <span key={reads}>
                {onSample && sample ? recordedReadLine(state.skinType, sample.data.skinType.recordedOn) : suggestedLine(state.skinType)}
              </span>
            )}
          </p>
        )}
        {state.tone === "deeper" && <p className="max-w-[34rem] font-bold">{DEEPER_LINE}</p>}
        <BottleChips bottles={chips} selectedId={state.bottleId} disabled={!canPick(state) || preparing} onPick={(id) => void onPick(id)} />
        {api.search && bottles.length > 0 && <BottleSearch search={api.search} onSelect={onFound} disabled={busy || preparing} />}
        {line && (
          <p role="alert" className="max-w-[34rem] rounded-2xl border-2 border-ink bg-paper p-4 font-bold">
            {line}
          </p>
        )}
        {/* Always present (a live region announces changes only once it exists); one line reserved, so nothing jumps. */}
        <p role="status" className="font-bold min-h-[1.5em]">
          {progressLine(waiting && !busy ? "rendering" : state.phase, wait.elapsed !== null && wait.elapsed * 1000 >= SLOW_MS, onSample)}
          {wait.elapsed !== null && (
            <span data-testid="elapsed" aria-hidden="true" className="ml-2 tabular-nums">
              {wait.elapsed} s
            </span>
          )}
        </p>
      </div>
      {bottle && shown && (
        <div ref={resultRef} data-testid="result-panel" className="grid gap-4 min-w-0 scroll-mt-24 lg:col-start-2 xl:col-start-3 xl:row-start-1">
          <ResultBlock word={formatValue(shown.whitening)} line={`${bottle.name} on skin of L* ${shown.lStar}. Predicted from the label; the picture is an approximation.`} />
          {hi > lo && (
            <Bars
              rows={[{ label: bottle.name, value: shown.whitening.value, low: shown.whitening.low, high: shown.whitening.high }]}
              domain={[lo, hi]}
              format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} ${shown.whitening.unit}`}
              ariaLabel="Predicted white cast"
            />
          )}
          <Link href="/evidence" className="justify-self-start font-extrabold underline decoration-[3px] underline-offset-4 decoration-amber">
            See the evidence
          </Link>
        </div>
      )}
    </div>
  );
}

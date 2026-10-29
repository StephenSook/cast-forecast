"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiFailure, readSkinType, renderBottle, uploadSelfie } from "@/lib/apiClient";
import { type Bottle, TONES, type Tone, findBottle, formatValue, toneOf, whiteningDomain } from "@/lib/catalogue";
import { type PreparedImage, releaseImage } from "@/lib/image";
import { type CfErrorCode, MESSAGES } from "@/lib/messages";
import { EXPIRED_LINE, type TryEvent, type TryState, canPick, canSuggest, initialTryState, tryReducer } from "@/lib/tryFlow";
import { Bars } from "./Bars";
import { BottleChips } from "./BottleChips";
import { CaptureFrame } from "./CaptureFrame";
import { ResultBlock } from "./ResultBlock";
import { ToneSwatches } from "./ToneSwatches";

/** After this long in flight the status line says the wait can be long, and how long. */
const SLOW_MS = 10_000;

/** Shown when the shopper's skin is deeper than any tone the study measured. */
export const DEEPER_LINE = "The study behind these numbers measured skin down to L* 44. Deeper skin has no prediction yet.";

type Api = { upload: typeof uploadSelfie; render: typeof renderBottle; readSkinType: typeof readSkinType };
const DEFAULT_API: Api = { upload: uploadSelfie, render: renderBottle, readSkinType };

/** The line under the tones once YouCam has read the selfie's skin type. */
export function suggestedLine(fitzpatrick: string): string {
  return `YouCam reads Fitzpatrick type ${fitzpatrick}. We picked the closest tone; change it if it looks off.`;
}

function progressLine(phase: TryState["phase"], slow: boolean): string {
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
 */
export function TryFlow({ bottles, tones = TONES, initialBottleId = null, api = DEFAULT_API, prepare }: {
  bottles: readonly Bottle[];
  tones?: readonly Tone[];
  initialBottleId?: string | null;
  api?: Api;
  prepare?: (f: File) => Promise<PreparedImage>;
}) {
  const [state, setState] = useState<TryState>(() => initialTryState(initialBottleId));
  const live = useRef(state);
  const run = useRef(0);
  // A photo being prepared will replace the current one, so the chips are off meanwhile and no pick can start on the
  // old one. CaptureFrame reports it from inside the change event, and React re-renders before that event returns.
  const [preparing, setPreparing] = useState(false);
  // The render URL whose image has loaded; until then the frame keeps the selfie and the scan line.
  const [shownUrl, setShownUrl] = useState<string | null>(null);

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
    const mine = ++run.current;
    const current = () => mine === run.current;
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

  const onSuggest = async () => {
    const before = live.current;
    const started = send({ type: "READ_SKIN" });
    if (started === before || !started.image) return;
    wait.start();
    const mine = ++run.current;
    const current = () => mine === run.current;
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
      send({ type: "SKIN_READ", fitzpatrick: read.fitzpatrick });
    } catch (e) {
      if (current()) send({ type: "FAILED", ...failureOf(e) });
    }
  };

  const line = state.phase === "error" && state.code ? (state.message ?? MESSAGES[state.code]) : state.expired ? EXPIRED_LINE : "";
  const bottle = revealed && state.result ? findBottle(state.result.bottleId, bottles) : undefined;
  const shown = bottle && typeof state.tone === "number" ? toneOf(bottle, state.tone) : undefined;
  const [lo, hi] = whiteningDomain(bottles);

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] items-start">
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
      />
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
        {state.skinType && <p className="max-w-[34rem]">{suggestedLine(state.skinType)}</p>}
        {state.tone === "deeper" && <p className="max-w-[34rem] font-bold">{DEEPER_LINE}</p>}
        <BottleChips bottles={bottles} selectedId={state.bottleId} disabled={!canPick(state) || preparing} onPick={(id) => void onPick(id)} />
        {line && (
          <p role="alert" className="max-w-[34rem] rounded-2xl border-2 border-ink bg-paper p-4 font-bold">
            {line}
          </p>
        )}
        {/* Always present (a live region announces changes only once it exists); one line reserved, so nothing jumps. */}
        <p role="status" className="font-bold min-h-[1.5em]">
          {progressLine(waiting && !busy ? "rendering" : state.phase, wait.elapsed !== null && wait.elapsed * 1000 >= SLOW_MS)}
          {wait.elapsed !== null && (
            <span data-testid="elapsed" aria-hidden="true" className="ml-2 tabular-nums">
              {wait.elapsed} s
            </span>
          )}
        </p>
        {bottle && shown && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}

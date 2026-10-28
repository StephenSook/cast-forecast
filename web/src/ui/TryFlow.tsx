"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiFailure, renderBottle, uploadSelfie } from "@/lib/apiClient";
import { type Bottle, findBottle, formatWhitening, whiteningDomain } from "@/lib/catalogue";
import { type PreparedImage, releaseImage } from "@/lib/image";
import { type CfErrorCode, MESSAGES } from "@/lib/messages";
import { EXPIRED_LINE, type TryEvent, type TryState, canPick, initialTryState, tryReducer } from "@/lib/tryFlow";
import { Bars } from "./Bars";
import { BottleChips } from "./BottleChips";
import { CaptureFrame } from "./CaptureFrame";
import { ResultBlock } from "./ResultBlock";

/** After this long in flight the status line says the wait can be long, and how long. */
const SLOW_MS = 10_000;

type Api = { upload: typeof uploadSelfie; render: typeof renderBottle };
const DEFAULT_API: Api = { upload: uploadSelfie, render: renderBottle };

function progressLine(phase: TryState["phase"], slow: boolean): string {
  if (phase === "uploading") return slow ? "Still sending. Up to a minute." : "Sending your selfie.";
  if (phase === "rendering") return slow ? "Still rendering. Up to 2 minutes." : "Rendering the cast.";
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
 * The Try screen: a selfie, a bottle chip, then the render. The selfie leaves the browser only when a chip is tapped,
 * and only through `api.upload`; a second bottle reuses the uploaded file. Every transition goes through tryReducer
 * synchronously (a ref mirrors the state), so a double tap starts one render, and a newer photo or pick makes any
 * answer still in flight for an older one count for nothing.
 */
export function TryFlow({ bottles, initialBottleId = null, api = DEFAULT_API, prepare }: {
  bottles: readonly Bottle[];
  initialBottleId?: string | null;
  api?: Api;
  prepare?: (f: File) => Promise<PreparedImage>;
}) {
  const [state, setState] = useState<TryState>(() => initialTryState(initialBottleId));
  const live = useRef(state);
  const run = useRef(0);

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

  const busy = state.phase === "uploading" || state.phase === "rendering";
  const wait = useWaitClock(busy);

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
    if (picked === before || !picked.image) return;
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
      const result = await api.render(fileId, bottleId);
      if (!current()) return;
      send({ type: "RENDERED", result });
    } catch (e) {
      if (current()) send({ type: "FAILED", ...failureOf(e) });
    }
  };

  const line = state.phase === "error" && state.code ? (state.message ?? MESSAGES[state.code]) : state.expired ? EXPIRED_LINE : "";
  const showResult = state.phase === "result" && state.result !== null;
  const bottle = showResult && state.result ? findBottle(state.result.bottleId, bottles) : undefined;
  const [lo, hi] = whiteningDomain(bottles);

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] items-start">
      <CaptureFrame
        image={state.image}
        busy={busy}
        onImage={onImage}
        onError={onImageError}
        prepare={prepare}
        resultUrl={showResult ? state.result?.imageUrl : null}
        onResultError={() => send({ type: "IMAGE_EXPIRED" })}
      />
      <div className="grid gap-4 min-w-0">
        <BottleChips bottles={bottles} selectedId={state.bottleId} disabled={!canPick(state)} onPick={(id) => void onPick(id)} />
        {line && (
          <p role="alert" className="max-w-[34rem] rounded-2xl border-2 border-ink bg-paper p-4 font-bold">
            {line}
          </p>
        )}
        {/* Always present (a live region announces changes only once it exists); one line reserved, so nothing jumps. */}
        <p role="status" className="font-bold min-h-[1.5em]">
          {progressLine(state.phase, wait.elapsed !== null && wait.elapsed * 1000 >= SLOW_MS)}
          {wait.elapsed !== null && (
            <span data-testid="elapsed" aria-hidden="true" className="ml-2 tabular-nums">
              {wait.elapsed} s
            </span>
          )}
        </p>
        {bottle && (
          <>
            <ResultBlock word={formatWhitening(bottle)} line={bottle.name} />
            {hi > lo && (
              <Bars
                rows={[{ label: bottle.name, value: bottle.whitening.value, low: bottle.whitening.low, high: bottle.whitening.high }]}
                domain={[lo, hi]}
                format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} ${bottle.whitening.unit}`}
                ariaLabel="Measured white cast"
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

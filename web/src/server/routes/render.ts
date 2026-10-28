import "server-only";
import { z } from "zod";
import { findBottle } from "@/lib/catalogue";
import { colorIntensityForBlend } from "@/lib/curve";
import type { RenderResult } from "@/lib/types";
import { UNIT_COST } from "@/server/credits";
import type { RouteDeps } from "@/server/deps";
import { errorResponse } from "@/server/errors";
import { clientIp } from "@/server/limits";
import { makeupVtoPayload } from "@/server/payload";
import { guarded, mediaType, ok, paidTask, readJson, refusal, youcamFor } from "@/server/routes/common";
import { readSession } from "@/server/session";

const RenderBody = z.object({ fileId: z.string().min(1).max(512), bottleId: z.string().min(1).max(64) });

// YouCam result URLs live about 2 hours; the page is told 5 minutes less.
const RESULT_TTL_MS = 7_200_000 - 300_000;

function isHttpsUrl(s: string): boolean {
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * POST /api/render, JSON {fileId, bottleId}: 200 RenderResult. Every refusal that needs no YouCam call (configuration,
 * body, session, bottle) comes before the limiter and the balance read; one unit is held before the task starts.
 */
export function makeRenderHandler(deps: () => RouteDeps): (req: Request) => Promise<Response> {
  return guarded("render", async (req) => {
    const d = deps();
    const now = d.now();
    const { youcamKey: key, sessionSecret: secret } = d.env;
    if (!key || !secret) return errorResponse("not_configured", 503);
    // application/json is not a simple content type, so a cross-site caller needs a CORS preflight this app never grants.
    if (mediaType(req) !== "application/json") return errorResponse("bad_request", 400);
    const body = await readJson(req, RenderBody);
    if (!body) return errorResponse("bad_request", 400);

    // A file id is only renderable from the signed session that uploaded it.
    const session = readSession(req.headers.get("cookie"), secret, now);
    if (!session || !session.files.includes(body.fileId)) return errorResponse("session_missing", 401);

    // A bottle whose blend the K1b curve cannot reach would render a weaker cast than measured: refused like an unknown one.
    const bottle = findBottle(body.bottleId, d.catalogue);
    const target = bottle ? colorIntensityForBlend(bottle.render.blend) : null;
    if (!bottle || !target?.reachable) return errorResponse("unknown_bottle", 404);
    const payload = makeupVtoPayload(body.fileId, bottle.render.paletteHex, target.colorIntensity);

    const limit = d.limiter.take("render", session.sid, clientIp(req), now);
    if (!limit.ok) return refusal(limit);
    const yc = youcamFor(d, key);
    if (!yc) return errorResponse("not_configured", 503);

    const task = await paidTask(d, yc, now, UNIT_COST.render, "task/makeup-vto", payload);
    if ("response" in task) return task.response;
    const url = task.results.url;
    if (typeof url !== "string" || !isHttpsUrl(url)) return errorResponse("upstream", 502);
    const result: RenderResult = {
      imageUrl: url,
      bottleId: bottle.id,
      colorIntensity: target.colorIntensity,
      predictedBlend: target.predictedBlend,
      expiresAt: now + RESULT_TTL_MS,
    };
    return ok(result);
  });
}

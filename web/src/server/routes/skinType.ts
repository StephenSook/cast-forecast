import "server-only";
import { z } from "zod";
import { isFitzpatrick } from "@/lib/skinType";
import type { SkinTypeResult } from "@/lib/types";
import { UNIT_COST } from "@/server/credits";
import type { RouteDeps } from "@/server/deps";
import { errorResponse } from "@/server/errors";
import { clientIp } from "@/server/limits";
import { skinTypePayload } from "@/server/payload";
import { guarded, mediaType, ok, paidTask, readJson, refusal, youcamFor } from "@/server/routes/common";
import { readSession } from "@/server/session";

const SkinTypeBody = z.object({ fileId: z.string().min(1).max(512) });

/**
 * POST /api/skin-type, JSON {fileId}: 200 SkinTypeResult, YouCam's Fitzpatrick type for the uploaded selfie. The Try
 * screen turns it into a suggested tone (lib/skinType.ts) that the shopper confirms or changes. Every refusal that needs
 * no YouCam call comes before the limiter and the balance read; 10 units are held before the task starts.
 */
export function makeSkinTypeHandler(deps: () => RouteDeps): (req: Request) => Promise<Response> {
  return guarded("skin-type", async (req) => {
    const d = deps();
    const now = d.now();
    const { youcamKey: key, sessionSecret: secret } = d.env;
    if (!key || !secret) return errorResponse("not_configured", 503);
    if (mediaType(req) !== "application/json") return errorResponse("bad_request", 400);
    const body = await readJson(req, SkinTypeBody);
    if (!body) return errorResponse("bad_request", 400);

    const session = readSession(req.headers.get("cookie"), secret, now);
    if (!session || !session.files.includes(body.fileId)) return errorResponse("session_missing", 401);

    const limit = d.limiter.take("skinType", session.sid, clientIp(req), now);
    if (!limit.ok) return refusal(limit);
    const yc = youcamFor("skin-type", d, key);
    if (!yc) return errorResponse("not_configured", 503);

    const task = await paidTask(
      "skin-type",
      d,
      yc,
      now,
      UNIT_COST.skinType,
      "task/fitzpatrick-scale-analyzer",
      skinTypePayload(body.fileId),
    );
    if ("response" in task) return task.response;
    const fitzpatrick = task.results.fitzpatrick_scale;
    if (!isFitzpatrick(fitzpatrick)) return errorResponse("upstream", 502);
    const result: SkinTypeResult = { fitzpatrick };
    return ok(result);
  });
}

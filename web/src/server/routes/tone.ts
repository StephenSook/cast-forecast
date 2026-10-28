import "server-only";
import { z } from "zod";
import type { ToneResult } from "@/lib/types";
import { UNIT_COST } from "@/server/credits";
import type { RouteDeps } from "@/server/deps";
import { errorResponse } from "@/server/errors";
import { clientIp } from "@/server/limits";
import { tonePayload } from "@/server/payload";
import { guarded, mediaType, ok, paidTask, readJson, refusal, youcamFor } from "@/server/routes/common";
import { readSession } from "@/server/session";

const ToneBody = z.object({ fileId: z.string().min(1).max(512) });
const HEX = /^#[0-9A-Fa-f]{6}$/;

/** POST /api/tone, JSON {fileId}: 200 ToneResult. The render order without the bottle step; 20 units are held. */
export function makeToneHandler(deps: () => RouteDeps): (req: Request) => Promise<Response> {
  return guarded("tone", async (req) => {
    const d = deps();
    const now = d.now();
    const { youcamKey: key, sessionSecret: secret } = d.env;
    if (!key || !secret) return errorResponse("not_configured", 503);
    if (mediaType(req) !== "application/json") return errorResponse("bad_request", 400);
    const body = await readJson(req, ToneBody);
    if (!body) return errorResponse("bad_request", 400);

    const session = readSession(req.headers.get("cookie"), secret, now);
    if (!session || !session.files.includes(body.fileId)) return errorResponse("session_missing", 401);

    const limit = d.limiter.take("tone", session.sid, clientIp(req), now);
    if (!limit.ok) return refusal(limit);
    const yc = youcamFor(d, key);
    if (!yc) return errorResponse("not_configured", 503);

    const task = await paidTask(d, yc, now, UNIT_COST.tone, "task/skin-tone-analysis", tonePayload(body.fileId));
    if ("response" in task) return task.response;
    const color = task.results.color;
    const skin = typeof color === "object" && color !== null ? (color as Record<string, unknown>).skin_color : undefined;
    if (typeof skin !== "string" || !HEX.test(skin)) return errorResponse("upstream", 502);
    const result: ToneResult = { skinColor: skin };
    return ok(result);
  });
}

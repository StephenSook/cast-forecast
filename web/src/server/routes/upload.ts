import "server-only";
import type { RouteDeps } from "@/server/deps";
import { errorResponse } from "@/server/errors";
import { MAX_UPLOAD_BYTES, checkUploadImage, stripMetadata } from "@/server/jpeg";
import { clientIp } from "@/server/limits";
import { failure, guarded, mediaType, ok, readCapped, refusal, youcamFor } from "@/server/routes/common";
import { newSession, readSession, sessionCookie, withFile } from "@/server/session";

/**
 * POST /api/upload, image/jpeg bytes: 200 {fileId} and a session cookie listing it. Only the metadata-stripped copy
 * ever leaves this function; a JPEG the strip cannot fully walk is refused.
 */
export function makeUploadHandler(deps: () => RouteDeps): (req: Request) => Promise<Response> {
  return guarded("upload", async (req) => {
    const d = deps();
    const now = d.now();
    const { youcamKey: key, sessionSecret: secret } = d.env;
    if (!key || !secret) return errorResponse("not_configured", 503);
    if (mediaType(req) !== "image/jpeg") return errorResponse("unsupported_image", 415);

    const raw = await readCapped(req, MAX_UPLOAD_BYTES);
    if (raw === "too_large") return errorResponse("too_large", 413);
    if (raw === null) return errorResponse("bad_request", 400);
    const check = checkUploadImage(raw);
    if (!check.ok) return errorResponse(check.code, check.status);
    const stripped = stripMetadata(raw);
    if (!stripped) return errorResponse("unsupported_image", 415);

    // A valid cookie is kept as is (same sid, files and iat); anything else silently becomes a new session.
    const session = readSession(req.headers.get("cookie"), secret, now) ?? newSession(now);
    const limit = d.limiter.take("upload", session.sid, clientIp(req), now);
    if (!limit.ok) return refusal(limit);

    const yc = youcamFor("upload", d, key);
    if (!yc) return errorResponse("not_configured", 503);
    let fileId: string;
    try {
      fileId = await yc.upload(stripped, "selfie.jpg");
    } catch (e) {
      return failure("upload", e);
    }
    const cookie = sessionCookie(withFile(session, fileId), secret, new URL(req.url).protocol === "https:");
    return ok({ fileId }, { "Set-Cookie": cookie });
  });
}

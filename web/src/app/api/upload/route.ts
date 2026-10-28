import { defaultDeps } from "@/server/deps";
import { makeUploadHandler } from "@/server/routes/upload";

export const runtime = "nodejs";
// Worst case: the file registration (15 s) then the presigned PUT (30 s), youcam.ts timeouts.
export const maxDuration = 60;
export const POST = makeUploadHandler(defaultDeps);

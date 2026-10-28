import { defaultDeps } from "@/server/deps";
import { makeUploadHandler } from "@/server/routes/upload";

export const runtime = "nodejs";
// Worst case 55 s: the body read (10 s), the file registration (15 s), then the presigned PUT (30 s).
export const maxDuration = 60;
export const POST = makeUploadHandler(defaultDeps);

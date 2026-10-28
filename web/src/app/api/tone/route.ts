import { defaultDeps } from "@/server/deps";
import { makeToneHandler } from "@/server/routes/tone";

export const runtime = "nodejs";
// Above the 107 s worst case (10 s body read, balance read, task start, 50 s poll plus its last GET); see routes/common.ts.
export const maxDuration = 120;
export const POST = makeToneHandler(defaultDeps);

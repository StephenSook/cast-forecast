import { defaultDeps } from "@/server/deps";
import { makeMcpHandler, methodNotAllowed } from "@/server/routes/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Above the 10 s body read deadline (routes/common.ts); the tools themselves are pure compute.
export const maxDuration = 20;
export const POST = makeMcpHandler(defaultDeps);
export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;

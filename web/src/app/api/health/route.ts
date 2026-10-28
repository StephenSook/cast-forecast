import { defaultDeps } from "@/server/deps";
import { makeHealthHandler } from "@/server/routes/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = makeHealthHandler(defaultDeps);

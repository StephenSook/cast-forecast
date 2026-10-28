import { defaultDeps } from "@/server/deps";
import { makeCreditsHandler } from "@/server/routes/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = makeCreditsHandler(defaultDeps);

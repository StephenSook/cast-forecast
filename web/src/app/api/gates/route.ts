import { makeGatesHandler } from "@/server/routes/gates";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const GET = makeGatesHandler();

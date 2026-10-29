import { makeLabelModelHandler } from "@/server/routes/labelModel";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const GET = makeLabelModelHandler();

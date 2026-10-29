import { makeLabelsHandler } from "@/server/routes/labels";

export const runtime = "nodejs";
export const GET = makeLabelsHandler();

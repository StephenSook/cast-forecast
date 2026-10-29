import { makeLlmsHandler } from "@/server/routes/llms";

export const runtime = "nodejs";
// Reads the request's origin for the printed curls, like /evidence.
export const dynamic = "force-dynamic";
export const GET = makeLlmsHandler();

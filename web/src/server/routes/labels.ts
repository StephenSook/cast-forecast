import "server-only";
import type { Bottle } from "@/lib/catalogue";
import { foldText, searchEntries } from "@/lib/search";
import { errorResponse } from "@/server/errors";
import { LABELS, SEARCH_LIMIT } from "@/server/labels";

/** Longest query read; a brand and a product name fit well inside it. */
export const MAX_QUERY = 60;

/**
 * GET /api/labels?q=: 200 {total, bottles}, the first SEARCH_LIMIT labels whose name or brand match, as full catalogue
 * entries. No YouCam call and no session: the catalogue is public. A missing, empty or overlong q is a 400. The answer
 * changes only with a deploy, so shared caches may keep it for a day.
 */
export function makeLabelsHandler(list: readonly Bottle[] = LABELS): (req: Request) => Promise<Response> {
  return async (req) => {
    const q = new URL(req.url).searchParams.get("q");
    if (q === null || q.length > MAX_QUERY || !foldText(q)) return errorResponse("bad_request", 400);
    const { total, items } = searchEntries(list, q, SEARCH_LIMIT);
    return Response.json({ total, bottles: items }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=86400" } });
  };
}

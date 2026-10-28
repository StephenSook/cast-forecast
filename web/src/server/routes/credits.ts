import "server-only";
import { UNIT_COST, aboveFloor } from "@/server/credits";
import type { RouteDeps } from "@/server/deps";
import { errorResponse } from "@/server/errors";
import { clientIp } from "@/server/limits";
import { failure, guarded, ok, refusal, youcamFor } from "@/server/routes/common";

/** GET /api/credits: 200 {balance, floor, aboveFloor}, from the 30 s balance cache. Limited per IP only. */
export function makeCreditsHandler(deps: () => RouteDeps): (req: Request) => Promise<Response> {
  return guarded("credits", async (req) => {
    const d = deps();
    const now = d.now();
    const key = d.env.youcamKey;
    if (!key) return errorResponse("not_configured", 503);
    const limit = d.limiter.take("credits", null, clientIp(req), now);
    if (!limit.ok) return refusal(limit);
    const yc = youcamFor(d, key);
    if (!yc) return errorResponse("not_configured", 503);
    let balance: number;
    try {
      balance = await d.balance.get(yc, now);
    } catch (e) {
      return failure(e);
    }
    const floor = d.env.creditFloor;
    return ok({ balance, floor, aboveFloor: aboveFloor(balance, UNIT_COST.render, floor) });
  });
}

import "server-only";
import { loadGates } from "@/lib/gates";
import { RELEASE } from "@/lib/release";
import type { RouteDeps } from "@/server/deps";
import { ok } from "@/server/routes/common";

/** GET /api/health: whether the key and secret are set (never their values), counts and the Node version. No YouCam call. */
export function makeHealthHandler(deps: () => RouteDeps): (req: Request) => Promise<Response> {
  return async () => {
    const d = deps();
    return ok({
      release: RELEASE,
      youcam: d.env.youcamKey !== null,
      session: d.env.sessionSecret !== null,
      bottles: d.catalogue.length,
      gates: loadGates().length,
      node: process.versions.node,
    });
  };
}

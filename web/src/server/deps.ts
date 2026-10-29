import "server-only";
import type { Bottle } from "@/lib/catalogue";
import { type BalanceCache, createBalanceCache } from "@/server/credits";
import { type ServerEnv, readServerEnv } from "@/server/env";
import { LABELS } from "@/server/labels";
import { type Limiter, createLimiter } from "@/server/limits";
import { type YouCam, createYouCam } from "@/server/youcam";

/** Everything a route handler reads. Handlers call `deps()` once per request; tests pass their own. */
export type RouteDeps = {
  env: ServerEnv;
  youcam: (key: string) => YouCam;
  limiter: Limiter;
  catalogue: readonly Bottle[];
  balance: BalanceCache;
  now: () => number;
};

// One of each per server instance, shared by every route: counts and the cached balance live as long as the instance.
// So the limiter and the credit floor are per instance and best effort (README, web Limits).
const limiter = createLimiter();
const balance = createBalanceCache();

/** Production deps. The env is read on each call, so a missing key shows as unconfigured instead of failing at import. */
export function defaultDeps(): RouteDeps {
  return {
    env: readServerEnv(),
    youcam: (key) => createYouCam({ key }),
    limiter,
    // Every kept label, so a bottle found by search renders through the same checks as a chip.
    catalogue: LABELS,
    balance,
    now: () => Date.now(),
  };
}

import "server-only";
import { type Bottle, CATALOGUE } from "@/lib/catalogue";
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
  /** The featured bottles (the chips): what the MCP list_bottles tool lists. */
  catalogue: readonly Bottle[];
  /**
   * Every kept FDA label: what the render route and the MCP predict_cast and search_labels tools accept, so a bottle
   * found by search is treated like a chip everywhere.
   */
  labels: readonly Bottle[];
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
    // list_bottles keeps the featured list (one reply listing every label would be about 250 KB); search_labels pages
    // through the rest.
    catalogue: CATALOGUE,
    labels: LABELS,
    balance,
    now: () => Date.now(),
  };
}

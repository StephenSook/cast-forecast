import "server-only";
import type { YouCam } from "@/server/youcam";

/** YouCam units per task, charged on success only. */
export const UNIT_COST = { render: 1, tone: 20 } as const;

/** True when paying `cost` still leaves at least `floor` units. A non-finite balance is never above. */
export function aboveFloor(balance: number, cost: number, floor: number): boolean {
  return Number.isFinite(balance) && balance - cost >= floor;
}

export type BalanceCache = { get(yc: YouCam, now: number): Promise<number>; spend(units: number): void };

/**
 * Caches the live balance for `ttlMs` (fresh while `now - readAt < ttlMs`). `spend` lowers the cached value
 * after a paid task so the floor check stays honest between reads. Concurrent misses share one call;
 * a failed read is not cached.
 */
export function createBalanceCache(ttlMs = 30_000): BalanceCache {
  let value: number | null = null;
  let readAt = 0;
  let inflight: Promise<number> | null = null;

  return {
    get(yc, now) {
      if (value !== null && now - readAt < ttlMs) return Promise.resolve(value);
      if (inflight) return inflight;
      const p = yc.balance().then(
        (v) => {
          value = v;
          readAt = now;
          inflight = null;
          return v;
        },
        (e: unknown) => {
          inflight = null;
          throw e;
        },
      );
      inflight = p;
      return p;
    },
    spend(units) {
      if (value !== null) value -= units;
    },
  };
}

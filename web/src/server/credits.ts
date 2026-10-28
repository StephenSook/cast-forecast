import "server-only";
import type { YouCam } from "@/server/youcam";

/** YouCam units per task. The app counts them as spent once YouCam accepts the task (routes/common.ts paidTask). */
export const UNIT_COST = { render: 1, tone: 20 } as const;

/** True when paying `cost` still leaves at least `floor` units. A non-finite balance is never above. */
export function aboveFloor(balance: number, cost: number, floor: number): boolean {
  return Number.isFinite(balance) && balance - cost >= floor;
}

/**
 * Units held for one paid task. `keep` spends them (YouCam accepted the task), `refund` drops them (it never did);
 * only the first call acts.
 */
export type Hold = { keep(): void; refund(): void };

export type BalanceCache = {
  get(yc: YouCam, now: number): Promise<number>;
  spend(units: number): void;
  /** Holds `units` when paying them still leaves `floor`, else null. Rejects when the balance cannot be read. */
  reserve(yc: YouCam, now: number, units: number, floor: number): Promise<Hold | null>;
};

/**
 * Caches the live balance for `ttlMs` (fresh while `now - readAt < ttlMs`). `spend` lowers the cached value
 * after a paid task so the floor check stays honest between reads. Concurrent misses share one call;
 * a failed read is not cached. `get` answers the cached value minus the units held by tasks still running.
 */
export function createBalanceCache(ttlMs = 30_000): BalanceCache {
  let value: number | null = null;
  let readAt = 0;
  let inflight: Promise<void> | null = null;
  // Held apart from `value`, so a fresh read never erases a hold and a refund after one never inflates the balance.
  let held = 0;

  function load(yc: YouCam, now: number): Promise<void> {
    if (value !== null && now - readAt < ttlMs) return Promise.resolve();
    if (!inflight) {
      inflight = yc.balance().then(
        (v) => {
          value = v;
          readAt = now;
          inflight = null;
        },
        (e: unknown) => {
          inflight = null;
          throw e;
        },
      );
    }
    return inflight;
  }

  return {
    get(yc, now) {
      return load(yc, now).then(() => (value as number) - held);
    },
    spend(units) {
      if (value !== null) value -= units;
    },
    async reserve(yc, now, units, floor) {
      if (!Number.isSafeInteger(units) || units <= 0) throw new RangeError("units must be a positive integer");
      await load(yc, now);
      // No await between the check and the hold, so a concurrent request always sees this hold in its own check.
      if (value === null || !aboveFloor(value - held, units, floor)) return null;
      held += units;
      let open = true;
      const close = (): boolean => {
        if (!open) return false;
        open = false;
        held -= units;
        return true;
      };
      return {
        keep() {
          if (close() && value !== null) value -= units;
        },
        refund() {
          close();
        },
      };
    },
  };
}

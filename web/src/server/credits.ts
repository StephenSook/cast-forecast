import "server-only";
import type { YouCam } from "@/server/youcam";

/** YouCam units per task. The app counts them as spent once YouCam accepts the task (routes/common.ts paidTask). */
// skinType: AI Fitzpatrick Skin Type Analysis V1.0, 10 units (reference__ai_fitzpatrick_skin_type.md, Unit Consumption).
export const UNIT_COST = { render: 1, tone: 20, skinType: 10 } as const;

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
 * Caches the live balance for `ttlMs` (fresh while `now - readAt < ttlMs`). `spend` and a kept hold lower the
 * cached value after a paid task so the floor check stays honest between reads. Concurrent misses share one call;
 * a failed read is not cached. `get` answers the cached value minus the units held by tasks still running.
 * A read that was already in flight when a spend happened may predate it, so every unit spent after the read started
 * is subtracted from the value it returns. If YouCam had already counted that spend, it is subtracted twice until
 * the next read: the cache then under-reports, which only refuses a task early.
 * There is one cache per server instance (deps.ts), so the floor it enforces is per instance and best effort, not a
 * shared guarantee: instances never see each other's holds, and near the floor each can admit about one task on the
 * balance it last read. The YouCam account balance is the hard stop.
 */
export function createBalanceCache(ttlMs = 30_000): BalanceCache {
  let value: number | null = null;
  let readAt = 0;
  let inflight: Promise<void> | null = null;
  // Held apart from `value`, so a fresh read never erases a hold and a refund after one never inflates the balance.
  let held = 0;
  // Every unit ever spent here (spend and kept holds). Only differences are read, to count spends during a read.
  let spent = 0;

  function charge(units: number): void {
    spent += units;
    if (value !== null) value -= units;
  }

  function load(yc: YouCam, now: number): Promise<void> {
    if (value !== null && now - readAt < ttlMs) return Promise.resolve();
    if (!inflight) {
      const spentAtStart = spent;
      inflight = yc.balance().then(
        (v) => {
          value = v - (spent - spentAtStart);
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
      charge(units);
    },
    async reserve(yc, now, units, floor) {
      if (!Number.isSafeInteger(units) || units <= 0) throw new RangeError("units must be a positive integer");
      await load(yc, now);
      // No await between the check and the hold, so a concurrent request on this instance always sees this hold in
      // its own check. Another instance never does (see above).
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
          if (close()) charge(units);
        },
        refund() {
          close();
        },
      };
    },
  };
}

import { expect, test, vi } from "vitest";
import { UNIT_COST, aboveFloor, createBalanceCache } from "@/server/credits";
import type { YouCam } from "@/server/youcam";
import { NOW } from "../helpers/constants";

test("aboveFloor is true when balance - cost >= floor", () =>
  expect([aboveFloor(101, 1, 100), aboveFloor(100, 1, 100), aboveFloor(120, 20, 100), aboveFloor(119, 20, 100)]).toEqual([true, false, true, false]));
test("balance cache makes no second call within 30 s and spend lowers it", async () => {
  const balance = vi.fn(async () => 500);
  const c = createBalanceCache(); const yc = { balance } as unknown as YouCam;
  expect(await c.get(yc, NOW)).toBe(500);
  expect(await c.get(yc, NOW + 29_999)).toBe(500);
  expect(balance).toHaveBeenCalledTimes(1);
  c.spend(20);
  expect(await c.get(yc, NOW + 29_999)).toBe(480);
  expect(await c.get(yc, NOW + 30_000)).toBe(500);
  expect(balance).toHaveBeenCalledTimes(2);
});

// Beyond the brief.
test("unit costs: render 1, tone 20", () => expect(UNIT_COST).toEqual({ render: 1, tone: 20 }));
test("aboveFloor refuses a non-finite balance", () =>
  expect([aboveFloor(Number.NaN, 1, 100), aboveFloor(Number.POSITIVE_INFINITY, 1, 100)]).toEqual([false, false]));
test("concurrent misses share one balance call", async () => {
  let release: (n: number) => void = () => undefined;
  const balance = vi.fn(() => new Promise<number>((r) => { release = r; }));
  const c = createBalanceCache(); const yc = { balance } as unknown as YouCam;
  const both = Promise.all([c.get(yc, NOW), c.get(yc, NOW)]);
  release(300);
  expect(await both).toEqual([300, 300]);
  expect(balance).toHaveBeenCalledTimes(1);
});
test("a failed balance call is not cached", async () => {
  const balance = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(42);
  const c = createBalanceCache(); const yc = { balance } as unknown as YouCam;
  await expect(c.get(yc, NOW)).rejects.toThrow("down");
  expect(await c.get(yc, NOW)).toBe(42);
  expect(balance).toHaveBeenCalledTimes(2);
});
test("spend before any read changes nothing and a custom TTL is honoured", async () => {
  const balance = vi.fn(async () => 10);
  const c = createBalanceCache(1000); const yc = { balance } as unknown as YouCam;
  c.spend(5);
  expect(await c.get(yc, NOW)).toBe(10);
  expect(await c.get(yc, NOW + 1000)).toBe(10);
  expect(balance).toHaveBeenCalledTimes(2);
});

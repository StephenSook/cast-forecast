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

// Task 5 carry 1: reserve before the run, refund only when the task start fails (Codex r1 finding A).
test("reserve holds units at once and refund drops the hold (balance back to its prior value)", async () => {
  const c = createBalanceCache(); const yc = { balance: vi.fn(async () => 879) } as unknown as YouCam;
  const hold = await c.reserve(yc, NOW, 1, 100);
  expect(hold).not.toBeNull();
  expect(await c.get(yc, NOW)).toBe(878);
  hold!.refund();
  expect(await c.get(yc, NOW)).toBe(879);
});
test("keep turns the hold into a spend; keep and refund each act once", async () => {
  const c = createBalanceCache(); const yc = { balance: vi.fn(async () => 879) } as unknown as YouCam;
  const hold = (await c.reserve(yc, NOW, 20, 100))!;
  hold.keep(); hold.keep(); hold.refund();
  expect(await c.get(yc, NOW)).toBe(859);
  const other = (await c.reserve(yc, NOW, 1, 100))!;
  other.refund(); other.refund(); other.keep();
  expect(await c.get(yc, NOW)).toBe(859);
});
test("reserve returns null and holds nothing when the units would cross the floor", async () => {
  const c = createBalanceCache(); const yc = { balance: vi.fn(async () => 119) } as unknown as YouCam;
  expect(await c.reserve(yc, NOW, 20, 100)).toBeNull();
  expect(await c.get(yc, NOW)).toBe(119);
  expect(await c.reserve(yc, NOW, 19, 100)).not.toBeNull();
});
test("concurrent reserves at the floor edge: only one holds", async () => {
  let release: (n: number) => void = () => undefined;
  const balance = vi.fn(() => new Promise<number>((r) => { release = r; }));
  const c = createBalanceCache(); const yc = { balance } as unknown as YouCam;
  const both = Promise.all([c.reserve(yc, NOW, 1, 100), c.reserve(yc, NOW, 1, 100)]);
  release(101);
  expect((await both).filter((h) => h !== null)).toHaveLength(1);
  expect(balance).toHaveBeenCalledTimes(1);
});
test("a hold survives a cache refresh: refund after a refresh does not inflate the balance", async () => {
  const balance = vi.fn().mockResolvedValueOnce(879).mockResolvedValueOnce(879);
  const c = createBalanceCache(); const yc = { balance } as unknown as YouCam;
  const hold = (await c.reserve(yc, NOW, 1, 100))!;
  expect(await c.get(yc, NOW + 30_000)).toBe(878);                                       // fresh read, hold still subtracted
  hold.refund();
  expect(await c.get(yc, NOW + 30_000)).toBe(879);
});
test("a failed balance read rejects reserve and holds nothing", async () => {
  const balance = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(500);
  const c = createBalanceCache(); const yc = { balance } as unknown as YouCam;
  await expect(c.reserve(yc, NOW, 1, 100)).rejects.toThrow("down");
  expect(await c.get(yc, NOW)).toBe(500);
});
test("reserve refuses a non-positive or non-integer unit count", async () => {
  const c = createBalanceCache(); const yc = { balance: vi.fn(async () => 879) } as unknown as YouCam;
  for (const u of [0, -1, 1.5, Number.NaN]) await expect(c.reserve(yc, NOW, u, 100)).rejects.toThrow(RangeError);
  expect(await c.get(yc, NOW)).toBe(879);
});

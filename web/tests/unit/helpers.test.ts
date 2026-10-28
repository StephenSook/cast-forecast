import { expect, test } from "vitest";
import { assertNoUnscripted, fakeFetch, jsonReply } from "../helpers/fakeFetch";
import { fakeJpeg } from "../helpers/fakeJpeg";

const U = "https://x.test/a";

test("fakeFetch serves clones, consumes arrays in order and repeats the last reply", async () => {
  const ff = fakeFetch({ [`GET ${U}`]: [jsonReply(200, { n: 1 }), jsonReply(200, { n: 2 })], [`POST ${U}`]: jsonReply(201, { ok: true }) });
  const got = [];
  for (let i = 0; i < 3; i++) got.push(await (await ff.fetch(U, { headers: {} })).json());
  for (let i = 0; i < 2; i++) got.push((await ff.fetch(U, { method: "POST", headers: { a: "1" }, body: "b" })).status);
  expect(got).toEqual([{ n: 1 }, { n: 2 }, { n: 2 }, 201, 201]);
  expect(ff.calls[3]).toMatchObject({ method: "POST", url: U, headers: { a: "1" }, body: "b" });
  expect(ff.taskStarts()).toBe(0);
});
test("fakeFetch rejects with an Error reply and counts task starts", async () => {
  const boom = new TypeError("fetch failed");
  const task = "https://y.test/s2s/v2.0/task/makeup-vto";
  const ff = fakeFetch({ [`GET ${U}`]: boom, [`POST ${task}`]: jsonReply(200, {}) });
  await expect(ff.fetch(U, { headers: {} })).rejects.toBe(boom);
  await ff.fetch(task, { method: "POST", headers: {} });
  expect(ff.taskStarts()).toBe(1);
});
test("an unscripted call rejects, is recorded, and fails assertNoUnscripted once", async () => {
  const ff = fakeFetch({});
  await expect(ff.fetch(U, { headers: {} })).rejects.toThrow(/unscripted/);
  expect(ff.unscripted).toEqual([`GET ${U}`]);
  expect(() => assertNoUnscripted()).toThrow(`GET ${U}`);
  expect(() => assertNoUnscripted()).not.toThrow();                                           // registry cleared
});
test("a Headers instance is refused and reported", async () => {
  const ff = fakeFetch({ [`GET ${U}`]: jsonReply(200, {}) });
  await expect(ff.fetch(U, { headers: new Headers({ a: "1" }) })).rejects.toThrow(/plain object/);
  expect(() => assertNoUnscripted()).toThrow(/plain object/);
});
test("fakeJpeg with meta is fakeJpeg without it plus the two segments", () => {
  const plain = fakeJpeg(640, 480, "SOF2");
  const meta = fakeJpeg(640, 480, "SOF2", { app1: true, app13: true });
  const app1Len = (meta[22] << 8) | meta[23];
  const app13At = 20 + 2 + app1Len;
  const app13Len = (meta[app13At + 2] << 8) | meta[app13At + 3];
  expect([meta[20], meta[21], meta[app13At], meta[app13At + 1]]).toEqual([0xff, 0xe1, 0xff, 0xed]);
  expect(new Uint8Array([...meta.slice(0, 20), ...meta.slice(app13At + 2 + app13Len)])).toEqual(plain);
  expect(fakeJpeg(1, 2, "SOF0", { app1: true }).length).toBe(fakeJpeg(1, 2).length + 18);
});

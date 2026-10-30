// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { Sample } from "@/lib/sample";
import { TryFlow } from "@/ui/TryFlow";
import { testEntry } from "../helpers/entries";

// After a render shows, its result is scrolled into view only when it is not already fully on screen.
const chips = [testEntry()];
const data: Sample = {
  schemaVersion: 1,
  face: { src: "/sample/face.jpg", width: 697, height: 1079 },
  skinType: { fitzpatrick: "IV", recordedOn: "2026-10-29" },
  renders: [55, 60].map((tone) => ({ bottleId: "test-a", tone, colorIntensity: 9, predictedBlend: 0.03, src: `/sample/renders/test-a-${tone}.png`, recordedOn: "2026-10-29" })),
};
const sampleImage = { blob: new Blob(["s"], { type: "image/jpeg" }), width: 697, height: 1079, url: "blob:sample", sample: true as const };
const original = Element.prototype.getBoundingClientRect;

afterEach(() => {
  Element.prototype.getBoundingClientRect = original;
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  vi.restoreAllMocks();
});

async function renderResult(resultTop: number) {
  const scroll = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scroll });
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if ((this as HTMLElement).dataset?.testid === "result-panel") return { top: resultTop, bottom: resultTop + 300, left: 0, right: 300, width: 300, height: 300, x: 0, y: resultTop, toJSON: () => ({}) } as DOMRect;
    return original.call(this);
  };
  const api = { upload: vi.fn(), render: vi.fn(), readSkinType: vi.fn() };
  const user = userEvent.setup();
  render(<TryFlow bottles={chips} api={api} sample={{ data, load: async () => sampleImage }} />);
  await user.click(screen.getByRole("button", { name: "Use a sample face" }));
  await screen.findByRole("img", { name: "The sample face" });
  await user.click(screen.getByRole("button", { name: "Skin L* 55" }));
  await user.click(screen.getByRole("button", { name: "Test entry A" }));
  fireEvent.load(await screen.findByTestId("result-image"));
  await screen.findByTestId("result-panel");
  return scroll;
}

test("a result below the screen is scrolled into view by the least scroll, without animation under reduced motion", async () => {
  // tests/setup.ts reports prefers-reduced-motion: reduce.
  const scroll = await renderResult(1200);
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "nearest" });
});

test("a result already on screen (beside the frame on a wide screen) scrolls nothing", async () => {
  const scroll = await renderResult(100);
  expect(scroll).not.toHaveBeenCalled();
});

test("with motion allowed the scroll is smooth", async () => {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }) as MediaQueryList,
  );
  const scroll = await renderResult(1200);
  expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
});

/** A live render held open until `land` is called, with the page's scroll position under the test's control. */
async function slowLiveRender() {
  const scroll = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scroll });
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if ((this as HTMLElement).dataset?.testid === "result-panel") return { top: 1200, bottom: 1500, left: 0, right: 300, width: 300, height: 300, x: 0, y: 1200, toJSON: () => ({}) } as DOMRect;
    return original.call(this);
  };
  let y = 0;
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => y);
  let finish: (v: { imageUrl: string; bottleId: string; colorIntensity: number; predictedBlend: number; expiresAt: number }) => void = () => undefined;
  const api = {
    upload: vi.fn(async () => ({ fileId: "file-1" })),
    render: vi.fn(() => new Promise<{ imageUrl: string; bottleId: string; colorIntensity: number; predictedBlend: number; expiresAt: number }>((resolve) => (finish = resolve))),
    readSkinType: vi.fn(),
  };
  const own = { blob: new Blob(["x"], { type: "image/jpeg" }), width: 640, height: 480, url: "blob:own" };
  const user = userEvent.setup();
  render(<TryFlow bottles={chips} api={api} prepare={async () => own} sample={null} />);
  await user.upload(screen.getByTestId("upload-input"), new File(["x"], "a.jpg", { type: "image/jpeg" }));
  await user.click(screen.getByRole("button", { name: "Skin L* 55" }));
  y = 300; // where the page is when the pick goes out
  await user.click(screen.getByRole("button", { name: "Test entry A" }));
  await vi.waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));
  const land = async () => {
    finish({ imageUrl: "https://out.example/r.png", bottleId: "test-a", colorIntensity: 49, predictedBlend: 0.17, expiresAt: Date.now() + 6_000_000 });
    fireEvent.load(await screen.findByTestId("result-image"));
    await screen.findByTestId("result-panel");
  };
  return { scroll, land, moveTo: (to: number) => (y = to) };
}

test("a slow live render that lands after the shopper scrolled elsewhere does not move the page", async () => {
  const { scroll, land, moveTo } = await slowLiveRender();
  moveTo(1600); // read on down while the render was in flight
  await land();
  expect(scroll).not.toHaveBeenCalled();
});

test("a slow live render that lands while the shopper stayed put is brought into view", async () => {
  const { scroll, land, moveTo } = await slowLiveRender();
  moveTo(320); // a nudge, within the slack
  await land();
  expect(scroll).toHaveBeenCalledTimes(1);
});

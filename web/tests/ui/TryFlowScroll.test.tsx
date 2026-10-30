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

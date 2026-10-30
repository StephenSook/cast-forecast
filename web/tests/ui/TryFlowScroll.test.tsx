// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { Sample } from "@/lib/sample";
import { TryFlow, keyScrollsPage } from "@/ui/TryFlow";
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

test("picking the same sample bottle again, with its result off screen, brings it into view again", async () => {
  const scroll = await renderResult(1200);
  expect(scroll).toHaveBeenCalledTimes(1);
  // The same recorded image lands in the same render, so nothing about the result changes but the pick.
  await userEvent.setup().click(screen.getByRole("button", { name: "Test entry A" }));
  await vi.waitFor(() => expect(scroll).toHaveBeenCalledTimes(2));
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
    search: vi.fn(async () => ({ total: 0, bottles: [] })),
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

// The shopper scrolling while the render is in flight, by each kind of input.
test.each([
  ["a mouse wheel", () => fireEvent.wheel(window, { deltaY: 400 })],
  ["a touch drag", () => fireEvent.touchMove(window, { touches: [{ clientX: 10, clientY: 10 }] })],
  ["Page Down", () => fireEvent.keyDown(document.body, { key: "PageDown" })],
  ["Page Down with a button focused", () => fireEvent.keyDown(screen.getByRole("button", { name: "Suggest my tone" }), { key: "PageDown" })],
  ["a press on the page's scrollbar", () => fireEvent.pointerDown(document.documentElement)],
])("a slow live render that lands after the shopper scrolled away (%s) does not move the page", async (_how, scrollAway) => {
  const { scroll, land } = await slowLiveRender();
  scrollAway();
  await land();
  expect(scroll).not.toHaveBeenCalled();
});

test("the page moving by itself (it shortened, and the browser clamped the scroll) cancels nothing", async () => {
  const { scroll, land, moveTo } = await slowLiveRender();
  moveTo(40); // 260 px up with no input from the shopper
  await land();
  expect(scroll).toHaveBeenCalledTimes(1);
});

test("keys a control takes for itself are not the shopper scrolling: Space on a button, arrows in the search field", async () => {
  const { scroll, land } = await slowLiveRender();
  fireEvent.keyDown(screen.getByRole("button", { name: "Suggest my tone" }), { key: " " });
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Find your sunscreen" }), { key: "ArrowDown" });
  await land();
  expect(scroll).toHaveBeenCalledTimes(1);
});

test("keyScrollsPage: which key presses scroll the page itself", () => {
  const on = (el: Element, key: string, prevented = false) => {
    let out = false;
    const listen = (e: Event) => (out = keyScrollsPage(e as KeyboardEvent));
    window.addEventListener("keydown", listen);
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    if (prevented) e.preventDefault();
    el.dispatchEvent(e);
    window.removeEventListener("keydown", listen);
    return out;
  };
  document.body.innerHTML = '<button>b</button><input type="text"><input type="range"><a href="/x">a</a><textarea></textarea>';
  const [button, text, range, link, area] = ["button", "input[type=text]", "input[type=range]", "a", "textarea"].map((s) => document.querySelector(s) as Element);
  expect(on(document.body, "PageDown")).toBe(true);
  expect(on(document.body, " ")).toBe(true);
  expect(on(button, "PageDown")).toBe(true);
  expect(on(button, "ArrowDown")).toBe(true);
  expect(on(link, "End")).toBe(true);
  expect(on(button, " ")).toBe(false);
  expect(on(link, " ")).toBe(false);
  expect(on(text, "ArrowDown")).toBe(false);
  expect(on(text, " ")).toBe(false);
  expect(on(range, "ArrowUp")).toBe(false);
  expect(on(area, "PageDown")).toBe(false);
  expect(on(document.body, "a")).toBe(false);
  expect(on(document.body, "PageDown", true)).toBe(false); // a handler took it
  document.body.innerHTML = "";
});

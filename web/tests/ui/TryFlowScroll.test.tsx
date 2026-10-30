// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { Sample } from "@/lib/sample";
import { TryFlow, keyScrollsPage } from "@/ui/TryFlow";
import { testEntry } from "../helpers/entries";

// After a render shows it is brought into view, once per pick, unless it is already on screen or the shopper scrolled
// the page themselves meanwhile. From lg the result panel is the target; below lg the result sits in the frame card
// under the picture, and the frame is the target, so the face and the number show together.
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

/** The screen: from lg (`wide`) or not, and whether reduced motion is asked for. */
function media(o: { wide: boolean; reduce: boolean }): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: (o.reduce && query.includes("prefers-reduced-motion: reduce")) || (o.wide && query.includes("min-width: 64rem")),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 300, width: 300, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

/** Places the result panel (from lg), or the frame and the big number (below lg), at these tops on the screen. */
function geometry(g: { panel?: number; frame?: number; word?: number }): void {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const id = (this as HTMLElement).dataset?.testid;
    if (id === "result-panel" && g.panel !== undefined) return rect(g.panel, 300);
    if (id === "frame-slot" && g.frame !== undefined) return rect(g.frame, 700);
    if (id === "result-word" && g.word !== undefined) return rect(g.word, 50);
    return original.call(this);
  };
}

function spyScroll() {
  const scroll = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scroll });
  return scroll;
}

async function sampleResult() {
  const api = { upload: vi.fn(), render: vi.fn(), readSkinType: vi.fn() };
  const user = userEvent.setup();
  render(<TryFlow bottles={chips} api={api} sample={{ data, load: async () => sampleImage }} />);
  await user.click(screen.getByRole("button", { name: "Use a sample face" }));
  await screen.findByRole("img", { name: "The sample face" });
  await user.click(screen.getByRole("button", { name: "Skin L* 55" }));
  await user.click(screen.getByRole("button", { name: "Test entry A" }));
  fireEvent.load(await screen.findByTestId("result-image"));
  await screen.findByTestId("result-panel");
  return { user };
}

test("from lg: a result below the screen is scrolled into view by the least scroll, without animation under reduced motion", async () => {
  media({ wide: true, reduce: true });
  geometry({ panel: 1200 });
  const scroll = spyScroll();
  await sampleResult();
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "nearest" });
  expect(scroll.mock.contexts[0]).toBe(screen.getByTestId("result-panel"));
});

test("from lg: a result already on screen (beside the frame) scrolls nothing", async () => {
  media({ wide: true, reduce: true });
  geometry({ panel: 100 });
  const scroll = spyScroll();
  await sampleResult();
  expect(scroll).not.toHaveBeenCalled();
});

test("from lg: with motion allowed the scroll is smooth", async () => {
  media({ wide: true, reduce: false });
  geometry({ panel: 1200 });
  const scroll = spyScroll();
  await sampleResult();
  expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
});

test("below lg the result sits in the frame card, right under the picture and its label, above the photo buttons", async () => {
  media({ wide: false, reduce: true });
  await sampleResult();
  const panel = screen.getByTestId("result-panel");
  const card = screen.getByTestId("capture-frame").parentElement as HTMLElement;
  expect(card.contains(panel)).toBe(true);
  const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  expect(follows(screen.getByTestId("result-note"), panel)).toBe(true);
  expect(follows(panel, screen.getByRole("button", { name: /Take a selfie/ }))).toBe(true);
  // Reading order: the picture, its label, the number, then the controls.
  expect(follows(panel, screen.getByRole("button", { name: "Suggest my tone" }))).toBe(true);
});

test("below lg: the frame is brought to the top, under the nav, so the face and the number show together", async () => {
  media({ wide: false, reduce: true });
  geometry({ frame: -500, word: 400 });
  const scroll = spyScroll();
  await sampleResult();
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  expect(scroll.mock.contexts[0]).toBe(screen.getByTestId("frame-slot"));
});

test("below lg: a number below the screen also brings the frame up", async () => {
  media({ wide: false, reduce: false });
  geometry({ frame: 300, word: 900 });
  const scroll = spyScroll();
  await sampleResult();
  expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
});

test("below lg: with the frame's top and the number both on screen, nothing scrolls", async () => {
  media({ wide: false, reduce: true });
  geometry({ frame: 90, word: 600 });
  const scroll = spyScroll();
  await sampleResult();
  expect(scroll).not.toHaveBeenCalled();
});

test("picking the same sample bottle again, with its result off screen, brings it into view again", async () => {
  media({ wide: true, reduce: true });
  geometry({ panel: 1200 });
  const scroll = spyScroll();
  const { user } = await sampleResult();
  expect(scroll).toHaveBeenCalledTimes(1);
  // The same recorded image lands in the same render, so nothing about the result changes but the pick.
  await user.click(screen.getByRole("button", { name: "Test entry A" }));
  await vi.waitFor(() => expect(scroll).toHaveBeenCalledTimes(2));
});

/** A live render held open until `land` is called, with the page's scroll position under the test's control. */
async function slowLiveRender(wide = true) {
  media({ wide, reduce: true });
  geometry(wide ? { panel: 1200 } : { frame: -500, word: 400 });
  const scroll = spyScroll();
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

// The shopper scrolling while the render is in flight, by each kind of input, on either side of lg.
test.each([
  ["a mouse wheel", () => fireEvent.wheel(window, { deltaY: 400 })],
  ["a touch drag", () => fireEvent.touchMove(window, { touches: [{ clientX: 10, clientY: 10 }] })],
  ["Page Down", () => fireEvent.keyDown(document.body, { key: "PageDown" })],
  ["Page Down with a button focused", () => fireEvent.keyDown(screen.getByRole("button", { name: "Suggest my tone" }), { key: "PageDown" })],
  ["a press on the page's scrollbar", () => fireEvent.pointerDown(document.documentElement)],
])("a slow live render that lands after the shopper scrolled away (%s) does not move the page", async (_how, scrollAway) => {
  for (const wide of [true, false]) {
    const { scroll, land } = await slowLiveRender(wide);
    scrollAway();
    await land();
    expect(scroll, wide ? "from lg" : "below lg").not.toHaveBeenCalled();
    cleanup();
    vi.restoreAllMocks();
  }
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
  const make = (tag: string, attrs: Record<string, string> = {}) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.append(el);
    return el;
  };
  const button = make("button");
  const text = make("input", { type: "text" });
  const range = make("input", { type: "range" });
  const link = make("a", { href: "/x" });
  const area = make("textarea");
  expect(on(document.body, "PageDown")).toBe(true);
  expect(on(document.body, " ")).toBe(true);
  expect(on(button, "PageDown")).toBe(true);
  expect(on(button, "ArrowDown")).toBe(true);
  expect(on(link, "End")).toBe(true);
  expect(on(button, " ")).toBe(false);
  expect(on(link, " ")).toBe(true); // Space scrolls the page from a link; Enter follows it
  expect(on(link, "Enter")).toBe(false);
  expect(on(text, "ArrowDown")).toBe(false);
  expect(on(text, " ")).toBe(false);
  expect(on(range, "ArrowUp")).toBe(false);
  expect(on(area, "PageDown")).toBe(false);
  expect(on(document.body, "a")).toBe(false);
  expect(on(document.body, "PageDown", true)).toBe(false); // a handler took it
  for (const el of [button, text, range, link, area]) el.remove();
});

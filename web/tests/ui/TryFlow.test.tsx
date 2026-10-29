// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, type Mock, test, vi } from "vitest";
import { ApiFailure } from "@/lib/apiClient";
import type { Bottle } from "@/lib/catalogue";
import { ImageError, type PreparedImage } from "@/lib/image";
import { MESSAGES } from "@/lib/messages";
import { EXPIRED_LINE } from "@/lib/tryFlow";
import { TryFlow } from "@/ui/TryFlow";
import { expectNoAxeViolations } from "../axe";
import { NOW } from "../helpers/constants";
import { deferred } from "../helpers/deferred";
import { testEntry } from "../helpers/entries";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const image = { blob: new Blob(["x"], { type: "image/jpeg" }), width: 640, height: 480, url: "blob:a" };
const result = { imageUrl: "https://out.example/r.png", bottleId: "test-a", colorIntensity: 49, predictedBlend: 0.1697, expiresAt: NOW + 6_900_000 };
const bottles = [testEntry(), testEntry({ id: "test-b", name: "Test entry B" })];
function setup(o: { bottles?: readonly Bottle[]; initialBottleId?: string | null; upload?: Mock; render?: Mock; prepare?: (f: File) => Promise<PreparedImage>; user?: ReturnType<typeof userEvent.setup> } = {}) {
  const api = { upload: o.upload ?? vi.fn(async () => ({ fileId: "file-1" })),
    render: o.render ?? vi.fn(async (_f: string, b: string) => ({ ...result, bottleId: b })) };
  const user = o.user ?? userEvent.setup();
  const view = render(<TryFlow bottles={o.bottles ?? bottles} initialBottleId={o.initialBottleId} api={api} prepare={o.prepare ?? (async () => image)} />);
  const addPhoto = () => user.upload(screen.getByTestId("upload-input"), new File(["x"], "a.jpg", { type: "image/jpeg" }));
  const chip = (name: string) => screen.getByRole("button", { name });
  return { api, user, addPhoto, chip, ...view };
}
test("TryFlow sends one render for a double tap", async () => {                         // Review Focus 3
  const gate = deferred<{ fileId: string }>();
  const { api, user, addPhoto, chip } = setup({ upload: vi.fn(() => gate.promise) });
  await addPhoto(); await user.click(chip("Test entry A")); await user.click(chip("Test entry A"));
  gate.resolve({ fileId: "file-1" });
  await screen.findByTestId("result-image");
  expect(api.upload).toHaveBeenCalledTimes(1); expect(api.render).toHaveBeenCalledTimes(1);
});
test("second bottle reuses the fileId without a second upload", async () => {
  const { api, user, addPhoto, chip } = setup();
  await addPhoto(); await user.click(chip("Test entry A")); await screen.findByTestId("result-image");
  await user.click(chip("Test entry B")); await waitFor(() => expect(api.render).toHaveBeenCalledTimes(2));
  expect(api.upload).toHaveBeenCalledTimes(1); expect(api.render.mock.calls[1]).toEqual(["file-1", "test-b"]);
});
test("a new photo uploads again on the next pick", async () => {
  const { api, user, addPhoto, chip } = setup();
  await addPhoto(); await user.click(chip("Test entry A")); await screen.findByTestId("result-image");
  await addPhoto(); await user.click(chip("Test entry A")); await waitFor(() => expect(api.render).toHaveBeenCalledTimes(2));
  expect(api.upload).toHaveBeenCalledTimes(2);
});
test("shows the server line when render fails with face_position", async () => {       // Review Focus 4
  const { user, addPhoto, chip } = setup({ render: vi.fn(async () => { throw new ApiFailure("face_position"); }) });
  await addPhoto(); await user.click(chip("Test entry A"));
  expect(await screen.findByRole("alert")).toHaveTextContent(MESSAGES.face_position);
  expect(chip("Test entry A")).toBeEnabled();
});
test("shows the paused line on not_configured", async () => {                           // Review Focus 5
  const { user, addPhoto, chip } = setup({ upload: vi.fn(async () => { throw new ApiFailure("not_configured"); }) });
  await addPhoto(); await user.click(chip("Test entry A"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Try-on is paused. Evidence is open.");
});
test("asks to pick again when the result image fails to load", async () => {
  const { user, addPhoto, chip } = setup();
  await addPhoto(); await user.click(chip("Test entry A"));
  fireEvent.error(await screen.findByTestId("result-image"));
  expect(await screen.findByRole("alert")).toHaveTextContent(EXPIRED_LINE);
});
test("empty catalogue: the selfie stays local and nothing is uploaded", async () => {
  const { api, addPhoto } = setup({ bottles: [] });
  await addPhoto();
  expect(screen.getByTestId("selfie-preview")).toHaveAttribute("src", "blob:a");
  expect(screen.getByText("No bottles yet.")).toBeInTheDocument();
  expect(api.upload).not.toHaveBeenCalled();
});
test("initialBottleId preselects the chip and still waits for a tap", async () => {
  const { api, user, addPhoto, chip } = setup({ initialBottleId: "test-b" });
  expect(chip("Test entry B")).toHaveAttribute("aria-pressed", "true");
  await addPhoto();
  expect(api.upload).not.toHaveBeenCalled(); expect(api.render).not.toHaveBeenCalled();
  await user.click(chip("Test entry B")); await screen.findByTestId("result-image");
  expect(api.upload).toHaveBeenCalledTimes(1); expect(api.render.mock.calls[0]).toEqual(["file-1", "test-b"]);
});
test("has no axe violations", async () => { const { container } = setup(); await expectNoAxeViolations(container); });

test("a 429 shows the server's line with the real wait, not the fixed one", async () => {
  const line = "Too many tries. Try again in 45 minutes.";
  const { user, addPhoto, chip } = setup({ render: vi.fn(async () => { throw new ApiFailure("rate_limited", 2700, line); }) });
  await addPhoto(); await user.click(chip("Test entry A"));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(line); expect(alert).not.toHaveTextContent(MESSAGES.rate_limited);
});

test("an unexpected failure from the API layer still shows a line and allows a retry", async () => {
  const render = vi.fn().mockRejectedValueOnce(new Error("bug")).mockImplementation(async (_f: string, b: string) => ({ ...result, bottleId: b }));
  const { api, user, addPhoto, chip } = setup({ render });
  await addPhoto(); await user.click(chip("Test entry A"));
  expect(await screen.findByRole("alert")).toHaveTextContent(MESSAGES.upstream);
  await user.click(chip("Test entry A")); await screen.findByTestId("result-image");
  expect(api.upload).toHaveBeenCalledTimes(1); expect(api.render).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("session_missing makes the next tap upload again", async () => {
  const render = vi.fn().mockRejectedValueOnce(new ApiFailure("session_missing")).mockImplementation(async (_f: string, b: string) => ({ ...result, bottleId: b }));
  const upload = vi.fn().mockResolvedValueOnce({ fileId: "file-1" }).mockResolvedValueOnce({ fileId: "file-2" });
  const { api, user, addPhoto, chip } = setup({ upload, render });
  await addPhoto(); await user.click(chip("Test entry A"));
  expect(await screen.findByRole("alert")).toHaveTextContent(MESSAGES.session_missing);
  await user.click(chip("Test entry A")); await screen.findByTestId("result-image");
  expect(api.upload).toHaveBeenCalledTimes(2); expect(api.render.mock.calls[1]).toEqual(["file-2", "test-a"]);
});

test("an expired render uploads the selfie again on the next tap", async () => {
  const upload = vi.fn().mockResolvedValueOnce({ fileId: "file-1" }).mockResolvedValueOnce({ fileId: "file-2" });
  const { api, user, addPhoto, chip } = setup({ upload });
  await addPhoto(); await user.click(chip("Test entry A"));
  fireEvent.error(await screen.findByTestId("result-image"));
  await screen.findByRole("alert");
  expect(screen.getByTestId("selfie-preview")).toHaveAttribute("src", "blob:a");
  await user.click(chip("Test entry A")); await screen.findByTestId("result-image");
  expect(api.upload).toHaveBeenCalledTimes(2); expect(api.render.mock.calls[1]).toEqual(["file-2", "test-a"]);
});

test("after an expired render, a photo that cannot be used shows its own line", async () => {
  const prepare = vi.fn().mockResolvedValueOnce(image).mockRejectedValueOnce(new ImageError("unsupported_image"));
  const { user, addPhoto, chip } = setup({ prepare });
  await addPhoto(); await user.click(chip("Test entry A"));
  fireEvent.error(await screen.findByTestId("result-image"));
  expect(await screen.findByRole("alert")).toHaveTextContent(EXPIRED_LINE);
  await addPhoto();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(MESSAGES.unsupported_image));
});

test("a photo that cannot be used shows its line, uploads nothing, and the chips stay off", async () => {
  const { api, addPhoto, chip } = setup({ prepare: async () => { throw new ImageError("too_small"); } });
  await addPhoto();
  expect(await screen.findByRole("alert")).toHaveTextContent(MESSAGES.too_small);
  expect(chip("Test entry A")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Upload" })).toBeEnabled();
  expect(api.upload).not.toHaveBeenCalled();
});

test("chips stay off until there is a photo", async () => {
  const { addPhoto, chip } = setup();
  expect(chip("Test entry A")).toBeDisabled();
  await addPhoto();
  expect(chip("Test entry A")).toBeEnabled();
});

test("until the render's image loads, the selfie, the scan line and the rendering line stay; no result yet", async () => {
  const { user, addPhoto, chip } = setup();
  await addPhoto(); await user.click(chip("Test entry A"));
  const img = await screen.findByTestId("result-image");
  expect(screen.getByTestId("selfie-preview")).toHaveAttribute("src", "blob:a");
  expect(screen.getByTestId("scan-line")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Rendering the cast.");
  expect(screen.queryByTestId("result")).toBeNull();
  expect(screen.queryByRole("link", { name: "See the evidence" })).toBeNull();
  fireEvent.load(img);
  expect(screen.getByTestId("result")).toBeInTheDocument();
  expect(screen.queryByTestId("scan-line")).toBeNull();
  expect(screen.queryByTestId("elapsed")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent(/^$/);
});

test("a render whose image fails before it shows: the selfie stays, the line asks to pick again, a tap retries", async () => {
  const upload = vi.fn().mockResolvedValueOnce({ fileId: "file-1" }).mockResolvedValueOnce({ fileId: "file-2" });
  const { api, user, addPhoto, chip } = setup({ upload });
  await addPhoto(); await user.click(chip("Test entry A"));
  fireEvent.error(await screen.findByTestId("result-image"));
  expect(await screen.findByRole("alert")).toHaveTextContent(EXPIRED_LINE);
  expect(screen.getByTestId("selfie-preview")).toHaveAttribute("src", "blob:a");
  expect(screen.queryByTestId("scan-line")).toBeNull(); expect(screen.queryByTestId("result")).toBeNull();
  expect(chip("Test entry A")).toBeEnabled();
  await user.click(chip("Test entry A"));
  fireEvent.load(await screen.findByTestId("result-image"));
  expect(screen.getByTestId("result")).toBeInTheDocument(); expect(screen.queryByRole("alert")).toBeNull();
  expect(api.upload).toHaveBeenCalledTimes(2); expect(api.render.mock.calls[1]).toEqual(["file-2", "test-a"]);
});

test("a chip tap while a new photo is still being prepared starts nothing; the flow resumes once it is ready", async () => {
  const gate = deferred<PreparedImage>();
  const prepare = vi.fn().mockResolvedValueOnce(image).mockReturnValueOnce(gate.promise);
  const upload = vi.fn().mockResolvedValueOnce({ fileId: "file-1" }).mockResolvedValueOnce({ fileId: "file-2" });
  const { api, user, addPhoto, chip } = setup({ prepare, upload });
  await addPhoto(); await user.click(chip("Test entry A"));
  fireEvent.load(await screen.findByTestId("result-image"));
  fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [new File(["y"], "b.jpg", { type: "image/jpeg" })] } });
  expect(chip("Test entry A")).toBeDisabled(); expect(chip("Test entry B")).toBeDisabled();
  await user.click(chip("Test entry B"));
  expect(api.upload).toHaveBeenCalledTimes(1); expect(api.render).toHaveBeenCalledTimes(1);
  await act(async () => gate.resolve({ ...image, url: "blob:b" }));
  expect(chip("Test entry B")).toBeEnabled();
  await user.click(chip("Test entry B"));
  await waitFor(() => expect(api.render).toHaveBeenCalledTimes(2));
  expect(api.upload).toHaveBeenCalledTimes(2); expect(api.render.mock.calls[1]).toEqual(["file-2", "test-b"]);
});

test("the chips are off the moment the change event returns, so a tap right after it starts nothing", async () => {
  const gate = deferred<PreparedImage>();
  const prepare = vi.fn().mockResolvedValueOnce(image).mockReturnValueOnce(gate.promise);
  const { api, user, addPhoto, chip } = setup({ prepare });
  await addPhoto(); await user.click(chip("Test entry A"));
  fireEvent.load(await screen.findByTestId("result-image"));
  const b = chip("Test entry B");
  const input = screen.getByTestId("upload-input");
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["y"], "b.jpg", { type: "image/jpeg" })] });
  // Native events inside one act, so nothing the test does flushes a render between them: React itself re-renders
  // synchronously at the end of a change event (as in a browser), and the chip is already off when the tap lands.
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(b).toBeDisabled();
    b.click();
  });
  expect(api.upload).toHaveBeenCalledTimes(1); expect(api.render).toHaveBeenCalledTimes(1);
  await act(async () => gate.resolve({ ...image, url: "blob:b" }));
});

test("the result shows the predicted cast for the bottle and a link to the evidence", async () => {
  const { user, addPhoto, chip } = setup();
  await addPhoto(); await user.click(chip("Test entry A"));
  expect(await screen.findByTestId("result-image")).toHaveAttribute("src", "https://out.example/r.png");
  fireEvent.load(screen.getByTestId("result-image"));
  const block = screen.getByTestId("result");
  expect(within(block).getByText("+2.4 L*")).toBeInTheDocument();
  expect(within(block).getByText("Test entry A")).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Predicted white cast" })).toHaveTextContent("1.9 L* to +2.9 L*");
  expect(screen.getByRole("link", { name: "See the evidence" })).toHaveAttribute("href", "/evidence");
  expect(screen.queryByTestId("scan-line")).toBeNull();
  expect(screen.queryByTestId("selfie-preview")).toBeNull();
});

test("progress is spoken while waiting and says it is still working after 10 s", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const upload = deferred<{ fileId: string }>();
  const rendered = deferred<typeof result>();
  const { addPhoto, chip } = setup({ user, upload: vi.fn(() => upload.promise), render: vi.fn(() => rendered.promise) });
  expect(screen.getByRole("status")).toHaveTextContent("");
  await addPhoto(); await user.click(chip("Test entry A"));
  expect(screen.getByRole("status")).toHaveTextContent("Sending your selfie.");
  expect(screen.getByTestId("scan-line")).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTime(11_000));
  expect(screen.getByRole("status")).toHaveTextContent("Still sending. Up to a minute.");
  expect(screen.getByTestId("elapsed")).toHaveTextContent("11 s");
  await act(async () => upload.resolve({ fileId: "file-1" }));
  expect(screen.getByRole("status")).toHaveTextContent("Still rendering. Up to 2 minutes.");
  await act(async () => rendered.resolve(result));
  expect(screen.getByRole("status")).toHaveTextContent("Still rendering. Up to 2 minutes.");  // the image is still on its way
  fireEvent.load(screen.getByTestId("result-image"));
  expect(screen.getByRole("status")).toHaveTextContent(/^$/);
  expect(screen.queryByTestId("elapsed")).toBeNull();
});

test("a render starts with its own line before 10 s", async () => {
  const rendered = deferred<typeof result>();
  const { user, addPhoto, chip } = setup({ render: vi.fn(() => rendered.promise) });
  await addPhoto(); await user.click(chip("Test entry A"));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Rendering the cast."));
  await act(async () => rendered.resolve(result));
});

test("an answer for an older photo is dropped: no render for it", async () => {
  const gate = deferred<{ fileId: string }>();
  const second = { ...image, url: "blob:b" };
  const prepare = vi.fn().mockResolvedValueOnce(image).mockResolvedValueOnce(second);
  const { api, user, addPhoto, chip } = setup({ upload: vi.fn(() => gate.promise), prepare });
  await addPhoto(); await user.click(chip("Test entry A"));
  await act(async () => { fireEvent.change(screen.getByTestId("camera-input"), { target: { files: [new File(["y"], "b.jpg", { type: "image/jpeg" })] } }); });
  expect(screen.getByTestId("selfie-preview")).toHaveAttribute("src", "blob:b");
  await act(async () => gate.resolve({ fileId: "file-1" }));
  expect(api.render).not.toHaveBeenCalled();
  expect(chip("Test entry A")).toBeEnabled();
});

test("two taps that land before the chips re-render still start one upload", async () => {   // Review Focus 3
  const gate = deferred<{ fileId: string }>();
  const { api, addPhoto, chip } = setup({ upload: vi.fn(() => gate.promise) });
  await addPhoto();
  const a = chip("Test entry A");
  act(() => { a.click(); a.click(); });
  await act(async () => gate.resolve({ fileId: "file-1" }));
  await screen.findByTestId("result-image");
  expect(api.upload).toHaveBeenCalledTimes(1); expect(api.render).toHaveBeenCalledTimes(1);
});

test("a newer photo's upload wins even when the older upload answers last-but-one", async () => {
  const first = deferred<{ fileId: string }>();
  const second = deferred<{ fileId: string }>();
  const upload = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const prepare = vi.fn().mockResolvedValueOnce(image).mockResolvedValueOnce({ ...image, url: "blob:b" });
  const { api, user, addPhoto, chip } = setup({ upload, prepare });
  await addPhoto(); await user.click(chip("Test entry A"));
  await act(async () => { fireEvent.change(screen.getByTestId("camera-input"), { target: { files: [new File(["y"], "b.jpg", { type: "image/jpeg" })] } }); });
  await user.click(chip("Test entry A"));
  await act(async () => first.resolve({ fileId: "file-old" }));
  expect(api.render).not.toHaveBeenCalled();
  await act(async () => second.resolve({ fileId: "file-new" }));
  await screen.findByTestId("result-image");
  expect(api.render.mock.calls).toEqual([["file-new", "test-a"]]);
});

test("every object URL is revoked when its photo is replaced and when the flow unmounts", async () => {
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const prepare = vi.fn().mockResolvedValueOnce({ ...image, url: "blob:1" }).mockResolvedValueOnce({ ...image, url: "blob:2" });
  const { addPhoto, unmount } = setup({ prepare });
  await addPhoto();
  expect(revoke).not.toHaveBeenCalled();
  await addPhoto();
  expect(revoke.mock.calls).toEqual([["blob:1"]]);
  unmount();
  expect(revoke.mock.calls).toEqual([["blob:1"], ["blob:2"]]);
});

test("the selfie goes only to the upload call: no fetch of its own, no browser storage", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  const { api, user, addPhoto, chip } = setup();
  await addPhoto(); await user.click(chip("Test entry A")); await screen.findByTestId("result-image");
  await user.click(chip("Test entry B")); await waitFor(() => expect(api.render).toHaveBeenCalledTimes(2));
  expect(api.upload.mock.calls).toEqual([[image.blob]]);
  expect(fetchSpy).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
});

test("has no axe violations with a result and with an error, and with no bottles", async () => {
  const { container, user, addPhoto, chip, unmount } = setup({ render: vi.fn().mockRejectedValueOnce(new ApiFailure("no_face")).mockResolvedValueOnce(result) });
  await addPhoto(); await user.click(chip("Test entry A"));
  await screen.findByRole("alert");
  await expectNoAxeViolations(container);
  await user.click(chip("Test entry A"));
  await expectNoAxeViolations(container);
  fireEvent.load(await screen.findByTestId("result-image"));
  await screen.findByTestId("result");
  await expectNoAxeViolations(container);
  unmount();
  const empty = setup({ bottles: [] });
  await empty.addPhoto();
  await expectNoAxeViolations(empty.container);
});

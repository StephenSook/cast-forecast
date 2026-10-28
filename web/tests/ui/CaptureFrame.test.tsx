// @vitest-environment jsdom
import { type ComponentProps } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ImageError } from "@/lib/image";
import { CaptureFrame } from "@/ui/CaptureFrame";
import { expectNoAxeViolations } from "../axe";
import { deferred } from "../helpers/deferred";

afterEach(() => vi.restoreAllMocks());

const prepared = { blob: new Blob(["x"], { type: "image/jpeg" }), width: 640, height: 480, url: "blob:a" };
const jpeg = () => new File(["x"], "a.jpg", { type: "image/jpeg" });
function setup(p: Partial<ComponentProps<typeof CaptureFrame>> = {}) {
  const props = { image: null, busy: false, onImage: vi.fn(), onError: vi.fn(), prepare: vi.fn(async () => prepared), ...p };
  return { props, user: userEvent.setup(), ...render(<CaptureFrame {...props} />) };
}
test("camera input asks for the front camera; upload input does not; both accept JPEG and PNG", () => {
  setup();
  expect(screen.getByTestId("camera-input")).toHaveAttribute("capture", "user");
  expect(screen.getByTestId("upload-input")).not.toHaveAttribute("capture");
  for (const id of ["camera-input", "upload-input"]) expect(screen.getByTestId(id)).toHaveAttribute("accept", "image/jpeg,image/png");
});
test("calls onImage with the prepared image", async () => {
  const { props, user } = setup();
  await user.upload(screen.getByTestId("upload-input"), jpeg());
  expect(props.prepare).toHaveBeenCalledTimes(1); expect(props.onImage).toHaveBeenCalledWith(prepared); expect(props.onError).not.toHaveBeenCalled();
});
test("decode failure calls onError(unsupported_image) and never onImage", async () => {   // Review Focus 2
  const { props, user } = setup({ prepare: vi.fn(async () => { throw new ImageError("unsupported_image"); }) });
  await user.upload(screen.getByTestId("upload-input"), jpeg());
  expect(props.onError).toHaveBeenCalledWith("unsupported_image"); expect(props.onImage).not.toHaveBeenCalled();
});
test("a prepare failure that is not an ImageError also reports unsupported_image", async () => {
  const { props, user } = setup({ prepare: vi.fn(async () => { throw new Error("x"); }) });
  await user.upload(screen.getByTestId("upload-input"), jpeg());
  expect(props.onError).toHaveBeenCalledWith("unsupported_image");
});
test("empty frame has an accessible icon and no visible words", () => {
  setup(); const frame = screen.getByTestId("capture-frame");
  expect(frame.textContent).toBe(""); expect(within(frame).getByRole("img", { name: "Selfie frame" })).toBeInTheDocument();
});
test("shows the prepared selfie", () => {
  setup({ image: prepared }); expect(screen.getByTestId("selfie-preview")).toHaveAttribute("src", "blob:a");
});
test("busy shows the amber scan line; gone when not busy", () => {
  const { rerender, props } = setup({ image: prepared, busy: true });
  expect(screen.getByTestId("scan-line")).toHaveClass("bg-amber");
  rerender(<CaptureFrame {...props} busy={false} />);
  expect(screen.queryByTestId("scan-line")).toBeNull();
});
test("a result image that fails to load calls onResultError", () => {
  const onResultError = vi.fn(); setup({ image: prepared, resultUrl: "https://out.example/r.png", onResultError });
  fireEvent.error(screen.getByTestId("result-image")); expect(onResultError).toHaveBeenCalledTimes(1);
});
test("has no axe violations", async () => { const { container } = setup(); await expectNoAxeViolations(container); });

test("the two buttons open the camera input and the upload input", async () => {
  const { user } = setup();
  const camera = vi.spyOn(screen.getByTestId("camera-input"), "click");
  const upload = vi.spyOn(screen.getByTestId("upload-input"), "click");
  await user.click(screen.getByRole("button", { name: /Take a selfie/ }));
  expect(camera).toHaveBeenCalledTimes(1); expect(upload).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Upload" }));
  expect(upload).toHaveBeenCalledTimes(1);
});

test("both buttons are off while busy or while a photo is being prepared", async () => {
  const { rerender, props } = setup({ image: prepared, busy: true });
  expect(screen.getByRole("button", { name: /Take a selfie/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  const gate = deferred<typeof prepared>();
  rerender(<CaptureFrame {...props} busy={false} prepare={vi.fn(() => gate.promise)} />);
  fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [jpeg()] } });
  expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  await act(async () => gate.resolve(prepared));
  expect(screen.getByRole("button", { name: "Upload" })).toBeEnabled();
});

test("until the render has loaded, the selfie and the scan line stay; then the render replaces them", () => {
  const onResultLoad = vi.fn();
  setup({ image: prepared, resultUrl: "https://out.example/r.png", onResultLoad });
  const img = screen.getByTestId("result-image");
  expect(img).toHaveAttribute("src", "https://out.example/r.png");
  expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(img).toHaveClass("opacity-0"); expect(img).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByTestId("selfie-preview")).toBeInTheDocument();
  expect(screen.getByTestId("scan-line")).toBeInTheDocument();
  fireEvent.load(img);
  expect(onResultLoad).toHaveBeenCalledTimes(1);
  expect(img).not.toHaveClass("opacity-0"); expect(img).not.toHaveAttribute("aria-hidden");
  expect(screen.queryByTestId("selfie-preview")).toBeNull();
  expect(screen.queryByTestId("scan-line")).toBeNull();
});

test("a render that fails before it loads reports the failure and never hides the selfie", () => {
  const onResultError = vi.fn();
  const onResultLoad = vi.fn();
  setup({ image: prepared, resultUrl: "https://out.example/r.png", onResultError, onResultLoad });
  fireEvent.error(screen.getByTestId("result-image"));
  expect(onResultError).toHaveBeenCalledTimes(1); expect(onResultLoad).not.toHaveBeenCalled();
  expect(screen.getByTestId("selfie-preview")).toBeInTheDocument();
});

test("a new render URL waits for its own load", () => {
  const { rerender, props } = setup({ image: prepared, resultUrl: "https://out.example/1.png" });
  fireEvent.load(screen.getByTestId("result-image"));
  expect(screen.queryByTestId("scan-line")).toBeNull();
  rerender(<CaptureFrame {...props} resultUrl="https://out.example/2.png" />);
  expect(screen.getByTestId("result-image")).toHaveClass("opacity-0");
  expect(screen.getByTestId("scan-line")).toBeInTheDocument();
  expect(screen.getByTestId("selfie-preview")).toBeInTheDocument();
});

test("reports preparation upward: on when a photo starts, off when the newest one is done or refused", async () => {
  const onPreparing = vi.fn();
  const first = deferred<typeof prepared>();
  const prepare = vi.fn().mockReturnValueOnce(first.promise).mockRejectedValueOnce(new ImageError("too_small"));
  setup({ prepare, onPreparing });
  fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [jpeg()] } });
  expect(onPreparing.mock.calls).toEqual([[true]]);
  await act(async () => first.resolve(prepared));
  expect(onPreparing.mock.calls).toEqual([[true], [false]]);
  await act(async () => { fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [jpeg()] } }); });
  expect(onPreparing.mock.calls).toEqual([[true], [false], [true], [false]]);
});

test("a photo that loses the race does not switch preparation off while the newer one is still going", async () => {
  const onPreparing = vi.fn();
  const older = deferred<typeof prepared>();
  const newer = deferred<typeof prepared>();
  const prepare = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  setup({ prepare, onPreparing });
  fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [jpeg()] } });
  fireEvent.change(screen.getByTestId("camera-input"), { target: { files: [jpeg()] } });
  await act(async () => older.resolve({ ...prepared, url: "blob:older" }));
  expect(onPreparing.mock.calls).toEqual([[true], [true]]);
  await act(async () => newer.resolve(prepared));
  expect(onPreparing.mock.calls).toEqual([[true], [true], [false]]);
});

test("the file inputs are visually hidden, not display:none, and kept out of the tab order and the a11y tree", () => {
  setup();
  for (const id of ["camera-input", "upload-input"]) {
    const input = screen.getByTestId(id);
    expect(input).toHaveClass("sr-only"); expect(input).not.toHaveClass("hidden");
    expect(input).toHaveAttribute("tabindex", "-1"); expect(input).toHaveAttribute("aria-hidden", "true");
  }
});

test("only the newest photo is delivered; an older one that finishes late is released", async () => {
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const late = deferred<typeof prepared>();
  const older = { ...prepared, url: "blob:older" };
  const newer = { ...prepared, url: "blob:newer" };
  const prepare = vi.fn().mockReturnValueOnce(late.promise).mockResolvedValueOnce(newer);
  const { props } = setup({ prepare });
  fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [jpeg()] } });
  await act(async () => { fireEvent.change(screen.getByTestId("camera-input"), { target: { files: [jpeg()] } }); });
  await act(async () => late.resolve(older));
  expect(props.onImage).toHaveBeenCalledTimes(1); expect(props.onImage).toHaveBeenCalledWith(newer);
  expect(revoke).toHaveBeenCalledWith("blob:older"); expect(revoke).not.toHaveBeenCalledWith("blob:newer");
});

test("a photo that finishes after the frame is gone is released, not delivered", async () => {
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const gate = deferred<typeof prepared>();
  const { props, unmount } = setup({ prepare: vi.fn(() => gate.promise) });
  fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [jpeg()] } });
  unmount();
  await act(async () => gate.resolve(prepared));
  expect(props.onImage).not.toHaveBeenCalled(); expect(revoke).toHaveBeenCalledWith("blob:a");
});

test("has no axe violations with a selfie, while busy, and with a result", async () => {
  const { container, rerender, props } = setup({ image: prepared, busy: true });
  await expectNoAxeViolations(container);
  rerender(<CaptureFrame {...props} busy={false} resultUrl="https://out.example/r.png" />);
  await expectNoAxeViolations(container);
  fireEvent.load(screen.getByTestId("result-image"));
  await expectNoAxeViolations(container);
});

// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CopyLine } from "@/ui/CopyLine";
import { expectNoAxeViolations } from "../axe";

const CMD = "curl -s https://x/api/gates";

// Call after userEvent.setup(), which installs its own clipboard stub on navigator.
function installClipboard() {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

test("copies the text, says so, and says so when the copy fails", async () => {
  const user = userEvent.setup();
  const writeText = installClipboard();
  const { container } = render(<CopyLine text={CMD} />);
  await user.click(screen.getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith(CMD);
  expect(screen.getByRole("status")).toHaveTextContent("Copied");
  writeText.mockRejectedValueOnce(new Error("denied"));
  await user.click(screen.getByRole("button", { name: "Copy" }));
  expect(screen.getByRole("status")).toHaveTextContent("Copy failed. Select the text.");
  expect(container.querySelector("code")).toHaveClass("overflow-x-auto", "min-w-0");
});

test("a missing clipboard API shows the failure line", async () => {
  const user = userEvent.setup();
  Object.defineProperty(window.navigator, "clipboard", { value: undefined, configurable: true });
  render(<CopyLine text={CMD} />);
  await user.click(screen.getByRole("button", { name: "Copy" }));
  expect(screen.getByRole("status")).toHaveTextContent("Copy failed. Select the text.");
});

test("Copied clears after 1.5 s, and a later failure is not wiped by that timer", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const writeText = installClipboard();
    render(<CopyLine text={CMD} />);
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
    await act(() => vi.advanceTimersByTime(1600));
    expect(screen.getByRole("status")).toHaveTextContent("");

    await user.click(screen.getByRole("button", { name: "Copy" }));
    writeText.mockRejectedValueOnce(new Error("denied"));
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("status")).toHaveTextContent("Copy failed. Select the text.");
  } finally {
    vi.useRealTimers();
  }
});

test("the command scrolls inside its own box and can be reached by keyboard", () => {
  const { container } = render(<CopyLine text={CMD} />);
  const code = container.querySelector("code");
  expect(code).toHaveTextContent(CMD);
  expect(code).toHaveClass("overflow-x-auto", "min-w-0", "whitespace-nowrap");
  expect(code).toHaveAttribute("tabindex", "0");
});

test("has no axe violations", async () => {
  const { container } = render(<CopyLine text={CMD} />);
  await expectNoAxeViolations(container);
});

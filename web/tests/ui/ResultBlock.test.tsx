// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { gsap } from "gsap";
import { afterEach, expect, test, vi } from "vitest";
import { ResultBlock } from "@/ui/ResultBlock";
import { expectNoAxeViolations } from "../axe";

afterEach(() => vi.restoreAllMocks());

test("announces one word and one line", () => {
  render(<ResultBlock word="Light" line="A faint cast on you." tone="ink" />);
  const result = screen.getByTestId("result");
  expect(result).toHaveAttribute("aria-live", "polite");
  expect(result.querySelectorAll("p")).toHaveLength(2);
  expect(result.querySelectorAll("p")[0]).toHaveTextContent("Light");
  expect(result.querySelectorAll("p")[1]).toHaveTextContent("A faint cast on you.");
  expect(result).toHaveClass("bg-ink", "text-paper");
});

test("ink tone marks the block as an ink surface; light tones use ink text", () => {
  const { unmount } = render(<ResultBlock word="W" line="L" tone="ink" />);
  expect(screen.getByTestId("result")).toHaveClass("on-ink");
  unmount();
  for (const tone of ["paper", "amber", "aqua"] as const) {
    const { unmount: done } = render(<ResultBlock word="W" line="L" tone={tone} />);
    expect(screen.getByTestId("result")).toHaveClass(`bg-${tone}`, "text-ink");
    expect(screen.getByTestId("result")).not.toHaveClass("text-paper");
    done();
  }
});

test("the word wraps instead of overflowing and children render below", () => {
  render(
    <ResultBlock word="Heavy" line="A strong cast on you.">
      <span>extra</span>
    </ResultBlock>,
  );
  const [word, line] = screen.getByTestId("result").querySelectorAll("p");
  // The word is capped by the block's own width (28cqi of the @container), so it also fits a narrow column.
  expect(word).toHaveClass("display", "text-[length:min(clamp(3.2rem,12vw,11rem),28cqi)]", "break-words");
  expect(line).toHaveClass("text-lg", "@md:text-2xl", "font-bold");
  expect(screen.getByText("extra")).toBeInTheDocument();
  expect(screen.getByTestId("result")).toHaveClass("bg-paper", "@container");
});

test("skips the entrance pop under reduced motion", () => {
  const fromTo = vi.spyOn(gsap, "fromTo");
  render(<ResultBlock word="Light" line="A faint cast on you." />);
  expect(fromTo).not.toHaveBeenCalled();
});

test("pops in from scale 0.6, rotate -8 with elastic.out(1,0.6) when motion is allowed", () => {
  const real = window.matchMedia;
  window.matchMedia = (query: string) => ({ ...real(query), matches: false });
  try {
    const fromTo = vi.spyOn(gsap, "fromTo");
    render(<ResultBlock word="Light" line="A faint cast on you." />);
    expect(fromTo).toHaveBeenCalledTimes(1);
    const [target, from, to] = fromTo.mock.calls[0];
    expect(target).toBe(screen.getByTestId("result"));
    expect(from).toEqual({ scale: 0.6, rotate: -8 });
    expect(to).toMatchObject({ scale: 1, rotate: 0, duration: 0.8, ease: "elastic.out(1,0.6)" });
  } finally {
    window.matchMedia = real;
  }
});

test("has no axe violations", async () => {
  const { container } = render(<ResultBlock word="Light" line="A faint cast on you." tone="ink" />);
  await expectNoAxeViolations(container);
});

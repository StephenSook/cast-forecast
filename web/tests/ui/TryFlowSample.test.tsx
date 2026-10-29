// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { Sample } from "@/lib/sample";
import { SAMPLE_LIVE_LINE, recordedReadLine, recordedRenderLine } from "@/lib/sample";
import { TryFlow } from "@/ui/TryFlow";
import { expectNoAxeViolations } from "../axe";
import { testEntry } from "../helpers/entries";

afterEach(() => vi.restoreAllMocks());

const chips = [testEntry(), testEntry({ id: "test-b", name: "Test entry B" })];
const found = testEntry({ id: "test-found", name: "Test entry found", brand: "Search brand" });
const TONE_LS = [65, 60, 55, 50, 45];
const data: Sample = {
  schemaVersion: 1,
  face: { src: "/sample/face.jpg", width: 697, height: 1079 },
  skinType: { fitzpatrick: "III", recordedOn: "2026-10-29" },
  renders: chips.flatMap((b) =>
    TONE_LS.map((tone) => ({ bottleId: b.id, tone, colorIntensity: 9, predictedBlend: 0.03, src: `/sample/renders/${b.id}-${tone}.png`, recordedOn: "2026-10-29" })),
  ),
};
const sampleImage = { blob: new Blob(["s"], { type: "image/jpeg" }), width: 697, height: 1079, url: "blob:sample", sample: true as const };
const ownImage = { blob: new Blob(["x"], { type: "image/jpeg" }), width: 640, height: 480, url: "blob:own" };

function setup() {
  const api = {
    upload: vi.fn(async () => ({ fileId: "file-1" })),
    render: vi.fn(async (_f: string, b: string) => ({ imageUrl: "https://out.example/r.png", bottleId: b, colorIntensity: 49, predictedBlend: 0.17, expiresAt: 1 })),
    readSkinType: vi.fn(async () => ({ fitzpatrick: "IV" as const })),
    search: vi.fn(async () => ({ total: 1, bottles: [found] })),
  };
  const load = vi.fn(async () => sampleImage);
  const user = userEvent.setup();
  const view = render(<TryFlow bottles={chips} api={api} prepare={async () => ownImage} sample={{ data, load }} />);
  const useSample = async () => {
    await user.click(screen.getByRole("button", { name: "Use a sample face" }));
    await screen.findByRole("img", { name: "The sample face" });
  };
  // Only the paid routes count: search is free (/api/labels) and stays allowed.
  const paid = () => api.upload.mock.calls.length + api.render.mock.calls.length + api.readSkinType.mock.calls.length;
  return { api, load, user, useSample, paid, ...view };
}

test("each featured bottle at each tone shows its recorded render, labelled, with no upload, render or skin type call", async () => {
  const { user, useSample, paid } = setup();
  await useSample();
  for (const tone of TONE_LS) {
    await user.click(screen.getByRole("button", { name: `Skin L* ${tone}` }));
    for (const b of chips) {
      await user.click(screen.getByRole("button", { name: b.name }));
      const img = await screen.findByTestId("result-image");
      await waitFor(() => expect(img).toHaveAttribute("src", `/sample/renders/${b.id}-${tone}.png`));
      // Never worded as a live render while the recording loads.
      expect(screen.getByText(/Loading the recorded render\./)).toBeInTheDocument();
      expect(screen.queryByText(/Rendering the cast/)).toBeNull();
      fireEvent.load(img);
      expect(await screen.findByTestId("result-note")).toHaveTextContent(recordedRenderLine("2026-10-29"));
      expect(screen.getByRole("img", { name: "The sample face with the bottle's cast" })).toBeInTheDocument();
    }
  }
  expect(paid()).toBe(0);
});

test("Suggest my tone on the sample face shows the recorded read and its tone, with no call", async () => {
  const { user, useSample, paid } = setup();
  await useSample();
  await user.click(screen.getByRole("button", { name: "Suggest my tone" }));
  expect(await screen.findByText(recordedReadLine("III", "2026-10-29"))).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Skin L* 60" })).toHaveAttribute("aria-pressed", "true");
  expect(paid()).toBe(0);
});

test("a label that is not a chip, found by search, says a live render needs your own selfie, and sends nothing", async () => {
  const { user, useSample, paid } = setup();
  await useSample();
  await user.click(screen.getByRole("button", { name: "Skin L* 55" }));
  await user.type(screen.getByRole("combobox", { name: "Find your sunscreen" }), "found");
  await user.click(await screen.findByRole("option", { name: /Test entry found/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent(SAMPLE_LIVE_LINE);
  expect(screen.queryByTestId("result-image")).toBeNull();
  expect(paid()).toBe(0);
});

test("a live render is never labelled recorded, and your own photo after the sample face uploads as usual", async () => {
  const { api, user, useSample } = setup();
  await useSample();
  await user.upload(screen.getByTestId("upload-input"), new File(["x"], "a.jpg", { type: "image/jpeg" }));
  expect(await screen.findByRole("img", { name: "Your selfie" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Skin L* 55" }));
  await user.click(screen.getByRole("button", { name: "Test entry A" }));
  const img = await screen.findByTestId("result-image");
  fireEvent.load(img);
  await waitFor(() => expect(api.render).toHaveBeenCalledWith("file-1", "test-a", 55));
  expect(api.upload).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("result-note")).toBeNull();
});

test("the sample face is reached and loaded from the keyboard", async () => {
  const { load, user } = setup();
  const button = screen.getByRole("button", { name: "Use a sample face" });
  for (let i = 0; i < 6 && document.activeElement !== button; i++) await user.tab();
  expect(button).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("img", { name: "The sample face" })).toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(1);
});

test("a sample face that does not load shows a line and changes nothing", async () => {
  const api = { upload: vi.fn(), render: vi.fn(), readSkinType: vi.fn() };
  const user = userEvent.setup();
  render(<TryFlow bottles={chips} api={api} sample={{ data, load: async () => { throw new Error("offline"); } }} />);
  await user.click(screen.getByRole("button", { name: "Use a sample face" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("That did not go through. Try again.");
  expect(screen.queryByRole("img", { name: "The sample face" })).toBeNull();
});

test("no sample button without a sample or without chips", () => {
  const api = { upload: vi.fn(), render: vi.fn(), readSkinType: vi.fn() };
  const a = render(<TryFlow bottles={chips} api={api} sample={null} />);
  expect(screen.queryByRole("button", { name: "Use a sample face" })).toBeNull();
  a.unmount();
  render(<TryFlow bottles={[]} api={api} sample={{ data, load: async () => sampleImage }} />);
  expect(screen.queryByRole("button", { name: "Use a sample face" })).toBeNull();
});

test("has no axe violations with a recorded render on screen", async () => {
  const { container, user, useSample } = setup();
  await useSample();
  await user.click(screen.getByRole("button", { name: "Skin L* 55" }));
  await user.click(screen.getByRole("button", { name: "Test entry A" }));
  fireEvent.load(await screen.findByTestId("result-image"));
  await screen.findByTestId("result-note");
  await expectNoAxeViolations(container);
});

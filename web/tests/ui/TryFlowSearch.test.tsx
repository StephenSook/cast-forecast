// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, type Mock, test, vi } from "vitest";
import { ApiFailure } from "@/lib/apiClient";
import { MESSAGES } from "@/lib/messages";
import { TryFlow } from "@/ui/TryFlow";
import { NOW } from "../helpers/constants";
import { testEntry } from "../helpers/entries";

const image = { blob: new Blob(["x"], { type: "image/jpeg" }), width: 640, height: 480, url: "blob:a" };
const chips = [testEntry(), testEntry({ id: "test-b", name: "Test entry B" })];
const found = testEntry({ id: "test-found", name: "Test entry found", brand: "Search brand" });

function setup(o: { render?: Mock; initialBottle?: typeof found; initialTone?: number } = {}) {
  const api = {
    upload: vi.fn(async () => ({ fileId: "file-1" })),
    render: o.render ?? vi.fn(async (_f: string, b: string) => ({ imageUrl: "https://out.example/r.png", bottleId: b, colorIntensity: 49, predictedBlend: 0.17, expiresAt: NOW + 6_900_000 })),
    readSkinType: vi.fn(async () => ({ fitzpatrick: "IV" as const })),
    search: vi.fn(async () => ({ total: 1, bottles: [found] })),
  };
  const user = userEvent.setup();
  render(<TryFlow bottles={chips} api={api} prepare={async () => image} initialBottle={o.initialBottle} initialTone={o.initialTone} />);
  const addPhoto = async (tone = true) => {
    await user.upload(screen.getByTestId("upload-input"), new File(["x"], "a.jpg", { type: "image/jpeg" }));
    if (tone) await user.click(screen.getByRole("button", { name: "Skin L* 55" }));
  };
  const pickFromSearch = async () => {
    await user.type(screen.getByRole("combobox", { name: "Find your sunscreen" }), "found");
    await user.click(await screen.findByRole("option", { name: /Test entry found/ }));
  };
  return { api, user, addPhoto, pickFromSearch };
}

test("a search result renders exactly like a chip: one upload, one render for that bottle and tone, then its result", async () => {
  const { api, addPhoto, pickFromSearch } = setup();
  await addPhoto();
  await pickFromSearch();
  await waitFor(() => expect(api.render).toHaveBeenCalledWith("file-1", "test-found", 55));
  expect(api.upload).toHaveBeenCalledTimes(1);
  // It joins the chips, picked, and the result names it.
  expect(screen.getByRole("button", { name: "Test entry found" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.load(await screen.findByTestId("result-image"));
  expect(await screen.findByText(/Test entry found on skin of L\* 55\. Predicted from the label/)).toBeInTheDocument();
});

test("a result picked before the photo is marked picked and sends nothing, then renders from its chip", async () => {
  const { api, user, addPhoto, pickFromSearch } = setup();
  await pickFromSearch();
  const chip = screen.getByRole("button", { name: "Test entry found" });
  expect(chip).toHaveAttribute("aria-pressed", "true");
  expect(api.upload).not.toHaveBeenCalled();
  expect(api.render).not.toHaveBeenCalled();
  await addPhoto();
  await user.click(chip);
  await waitFor(() => expect(api.render).toHaveBeenCalledWith("file-1", "test-found", 55));
});

test("a search result gets the same refusals as a chip", async () => {
  const { addPhoto, pickFromSearch } = setup({ render: vi.fn(async () => { throw new ApiFailure("unknown_bottle"); }) });
  await addPhoto();
  await pickFromSearch();
  expect(await screen.findByRole("alert")).toHaveTextContent(MESSAGES.unknown_bottle);
});

test("a label handed in from its bottle page starts as a picked chip, on the tone it came with", async () => {
  const { api, user } = setup({ initialBottle: found, initialTone: 45 });
  expect(screen.getByRole("button", { name: "Test entry found" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Skin L* 45" })).toHaveAttribute("aria-pressed", "true");
  await user.upload(screen.getByTestId("upload-input"), new File(["x"], "a.jpg", { type: "image/jpeg" }));
  await user.click(screen.getByRole("button", { name: "Test entry found" }));
  await waitFor(() => expect(api.render).toHaveBeenCalledWith("file-1", "test-found", 45));
});

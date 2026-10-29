// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { expectNoAxeViolations } from "../axe";

const env = vi.hoisted(() => ({ scanEnabled: true }));
vi.mock("@/server/env", () => ({
  readServerEnv: () => ({ youcamKey: null, sessionSecret: null, creditFloor: 100, toneEnabled: false, scanEnabled: env.scanEnabled }),
}));

import Scan from "@/app/scan/page";

const scan = (sp: Record<string, string>) => Scan({ params: Promise.resolve({}), searchParams: Promise.resolve(sp) } as PageProps<"/scan">);
beforeEach(() => {
  env.scanEnabled = true;
});

test("with the flag off, /scan is a 404", async () => {
  env.scanEnabled = false;
  await expect(scan({})).rejects.toMatchObject({ digest: expect.stringContaining("404") });
});

test("a real barcode opens its bottle page on the tone picked", async () => {
  // Supergoop Mineral Sheer Stick's openFDA UPC, typed as the 12 digits under the bars.
  await expect(scan({ upc: "816218029890", tone: "45" })).rejects.toMatchObject({
    digest: expect.stringContaining("/bottle/supergoop-mineral-sheer-stick?tone=45"),
  });
});

test("the form asks for a tone and a barcode, and an unknown barcode says so", async () => {
  const { container } = render(await scan({ upc: "123456789012", tone: "50" }));
  expect(screen.getByRole("radio", { name: "Skin L* 50" })).toBeChecked();
  expect(screen.getByRole("textbox", { name: "Barcode number" })).toHaveValue("123456789012");
  expect(screen.getByRole("alert")).toHaveTextContent("No FDA label in the catalogue has that barcode.");
  expect(screen.getByRole("link", { name: "Find it by name" })).toHaveAttribute("href", "/");
  await expectNoAxeViolations(container);
});

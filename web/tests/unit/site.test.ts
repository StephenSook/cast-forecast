import { expect, test } from "vitest";
import { siteUrl } from "@/lib/site";

test("siteUrl prefers SITE_URL, then the Vercel production host, then localhost", () => {
  expect(siteUrl({ SITE_URL: "https://cf.example" })).toBe("https://cf.example");
  expect(siteUrl({ SITE_URL: "", VERCEL_PROJECT_PRODUCTION_URL: "cast-forecast-web.vercel.app" })).toBe("https://cast-forecast-web.vercel.app");
  expect(siteUrl({})).toBe("http://localhost:3000");
});

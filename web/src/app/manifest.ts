import type { MetadataRoute } from "next";

/** Installable on a phone's home screen: Try opens full screen, like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cast Forecast",
    short_name: "Cast Forecast",
    description: "See a mineral sunscreen's white cast on your face before you buy.",
    start_url: "/",
    display: "standalone",
    background_color: "#fff8ec",
    theme_color: "#ffb020",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}

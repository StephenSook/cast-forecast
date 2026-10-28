import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { RELEASE } from "@/lib/release";
import { siteUrl } from "@/lib/site";
import "./globals.css";

// Self-hosted (SIL Open Font License, latin variable files from Google Fonts). next/font/google downloads the
// fonts during every build, and a failed download failed CI and could fail a production deploy.
const display = localFont({ src: "./fonts/bricolage-grotesque-latin.woff2", variable: "--font-display", weight: "700 800", display: "swap" });
const body = localFont({ src: "./fonts/figtree-latin.woff2", variable: "--font-body", weight: "500 800", display: "swap" });
const hand = localFont({ src: "./fonts/caveat-latin.woff2", variable: "--font-hand", weight: "500 700", display: "swap" });

export const metadata: Metadata = {
  title: "Cast Forecast",
  description: "See a mineral sunscreen's white cast on your face before you buy.",
  metadataBase: new URL(siteUrl()),
  other: { "cf-release": RELEASE },
};

export const viewport: Viewport = { themeColor: "#ffb020" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${hand.variable}`} suppressHydrationWarning>
      <head>
        {/* Mark JS + motion before paint so reveal targets start hidden only when they will animate. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('js-motion')",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

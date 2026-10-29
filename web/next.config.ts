import type { NextConfig } from "next";

/**
 * Response headers on every route. No Content-Security-Policy yet: the layout's inline motion script and Next's inline
 * payloads would need per-request nonces, and the render images come from a YouCam host the page does not choose.
 * Camera stays allowed for this origin, so no browser can read the policy as blocking the selfie input (capture="user").
 */
const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};
export default nextConfig;

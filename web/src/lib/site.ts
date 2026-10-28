/**
 * The site's absolute origin, used as `metadataBase`.
 * `SITE_URL` wins when set and non-empty. On Vercel, `VERCEL_PROJECT_PRODUCTION_URL` (a system variable
 * holding the production host without a scheme) comes next. Local dev falls back to localhost.
 */
export function siteUrl(env: Partial<NodeJS.ProcessEnv> = process.env): string {
  if (env.SITE_URL) return env.SITE_URL;
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

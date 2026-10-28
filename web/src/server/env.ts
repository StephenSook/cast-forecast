import "server-only";

export type ServerEnv = {
  youcamKey: string | null;
  sessionSecret: string | null;
  creditFloor: number;
  scanEnabled: boolean;
  /** TONE_ENABLED=1 opens POST /api/tone (20 units a call, called by no page). Off by default; never set in Vercel. */
  toneEnabled: boolean;
};

const MIN_SECRET_LENGTH = 32;
const DEFAULT_CREDIT_FLOOR = 100;

/**
 * Server configuration, read on each call so a missing value shows as unconfigured instead of crashing.
 * The key is trimmed and reads as null when empty or not printable ASCII; a secret under 32 characters
 * reads as null. CREDIT_FLOOR must be a whole number >= 0.
 * Takes a Partial because Next types NODE_ENV as required; process.env is passed by default.
 */
export function readServerEnv(env: Partial<NodeJS.ProcessEnv> = process.env): ServerEnv {
  // Trimmed; a key with anything outside printable ASCII left is unconfigured, so createYouCam never sees it.
  const key = env.YOUCAM_API_KEY?.trim();
  const secret = env.SESSION_SECRET;
  const floor = env.CREDIT_FLOOR;
  const parsedFloor = floor !== undefined && /^\d+$/.test(floor) ? Number(floor) : Number.NaN;
  return {
    youcamKey: key && /^[\x20-\x7e]+$/.test(key) ? key : null,
    sessionSecret: secret !== undefined && secret.length >= MIN_SECRET_LENGTH ? secret : null,
    creditFloor: Number.isSafeInteger(parsedFloor) ? parsedFloor : DEFAULT_CREDIT_FLOOR,
    scanEnabled: env.SCAN_ENABLED === "1",
    toneEnabled: env.TONE_ENABLED === "1",
  };
}

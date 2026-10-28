import "server-only";

export type ServerEnv = {
  youcamKey: string | null;
  sessionSecret: string | null;
  creditFloor: number;
  scanEnabled: boolean;
};

const MIN_SECRET_LENGTH = 32;
const DEFAULT_CREDIT_FLOOR = 100;

/**
 * Server configuration, read on each call so a missing value shows as unconfigured instead of crashing.
 * An empty key and a secret under 32 characters read as null. CREDIT_FLOOR must be a whole number >= 0.
 * Takes a Partial because Next types NODE_ENV as required; process.env is passed by default.
 */
export function readServerEnv(env: Partial<NodeJS.ProcessEnv> = process.env): ServerEnv {
  const key = env.YOUCAM_API_KEY;
  const secret = env.SESSION_SECRET;
  const floor = env.CREDIT_FLOOR;
  const parsedFloor = floor !== undefined && /^\d+$/.test(floor) ? Number(floor) : Number.NaN;
  return {
    youcamKey: key ? key : null,
    sessionSecret: secret !== undefined && secret.length >= MIN_SECRET_LENGTH ? secret : null,
    creditFloor: Number.isSafeInteger(parsedFloor) ? parsedFloor : DEFAULT_CREDIT_FLOOR,
    scanEnabled: env.SCAN_ENABLED === "1",
  };
}

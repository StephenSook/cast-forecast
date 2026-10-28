import type { Bottle } from "@/lib/catalogue";
import type { ServerEnv } from "@/server/env";

/** The in-store scan page is open only when a bottle has been measured and the server flag is on. */
export function scanEnabled(bottles: readonly Bottle[], env: ServerEnv): boolean {
  return bottles.length > 0 && env.scanEnabled;
}

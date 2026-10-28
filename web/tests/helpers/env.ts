import type { ServerEnv } from "@/server/env";
import { KEY, SECRET } from "./constants";

/** A configured server env for tests, with the placeholder key and secret. */
export function testEnv(o: Partial<ServerEnv> = {}): ServerEnv {
  return { youcamKey: KEY, sessionSecret: SECRET, creditFloor: 100, scanEnabled: false, ...o };
}

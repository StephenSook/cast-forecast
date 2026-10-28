/** A scripted stand-in for fetch. Tests never touch the network. */

export type Reply = Response | Error;

export type FakeCall = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal | undefined;
};

type Fake = { unscripted: string[] };

// Every fake built since the last assertNoUnscripted() call. tests/setup.ts drains it after each test.
const registry: Fake[] = [];

function isPlainObject(v: unknown): v is Record<string, string> {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Builds a fetch that answers only the scripted routes. Keys are `"<METHOD> <url>"`.
 * A Response reply is served as a clone, so one reply can answer many calls. An array is consumed in
 * order and its last reply repeats. An Error reply makes the call reject with it. Anything unscripted
 * is recorded in `unscripted` and rejects, and so is a call whose headers are not a plain object.
 */
export function fakeFetch(routes: Record<string, Reply | Reply[]>): {
  fetch: typeof fetch;
  calls: FakeCall[];
  unscripted: string[];
  taskStarts(): number;
} {
  const calls: FakeCall[] = [];
  const unscripted: string[] = [];
  const served = new Map<string, number>();
  registry.push({ unscripted });

  const fake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const fromRequest = input instanceof Request;
    const url = fromRequest ? input.url : String(input);
    const method = (init?.method ?? (fromRequest ? input.method : "GET")).toUpperCase();
    const key = `${method} ${url}`;
    const headers = init?.headers ?? {};
    if (!isPlainObject(headers)) {
      const why = `${key} (headers must be a plain object, got ${Object.prototype.toString.call(headers)})`;
      unscripted.push(why);
      throw new TypeError(`fakeFetch: ${why}`);
    }
    calls.push({ method, url, headers, body: init?.body, signal: init?.signal ?? undefined });

    const route = routes[key];
    if (route === undefined || (Array.isArray(route) && route.length === 0)) {
      unscripted.push(key);
      throw new TypeError(`fakeFetch: unscripted call ${key}`);
    }
    let reply: Reply;
    if (Array.isArray(route)) {
      const i = served.get(key) ?? 0;
      served.set(key, i + 1);
      reply = route[Math.min(i, route.length - 1)];
    } else {
      reply = route;
    }
    if (reply instanceof Response) return reply.clone();
    throw reply;
  };

  return {
    fetch: fake as typeof fetch,
    calls,
    unscripted,
    taskStarts: () => calls.filter((c) => c.method === "POST" && c.url.includes("/s2s/v2.0/task/")).length,
  };
}

/** A JSON response with the given status. */
export function jsonReply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Throws when any fake built in the current test recorded an unscripted call, then clears the registry. */
export function assertNoUnscripted(): void {
  const found = registry.flatMap((f) => f.unscripted);
  registry.length = 0;
  if (found.length > 0) throw new Error(`unscripted fetch calls:\n${found.join("\n")}`);
}

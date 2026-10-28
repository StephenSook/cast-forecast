/** The commit this build was made from, stamped into the page as `cf-release`. "dev" when unset. */
export const RELEASE: string = process.env.NEXT_PUBLIC_RELEASE_SHA || "dev";

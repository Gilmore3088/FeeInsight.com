import { verifyAndExtractSessionId } from "@/lib/session-cookie";

/**
 * Cached public pages that look different to a signed-in reader (#1811).
 *
 * The state, district and national research pages show Pro readers every fee category and
 * the full Beige Book text. A cached page is the same HTML for everyone, so each of these
 * pages has two routes: the public address is cached (ISR) and renders what a signed-out
 * reader sees, and a `/signed-in` route beside it reads the session and renders per request.
 * The proxy sends a request carrying a validly signed session cookie to the second route;
 * the address in the browser does not change. Crawlers and signed-out readers, nearly all
 * the traffic, never reach the database through these pages.
 *
 * The `/signed-in` routes answer 404 when asked for directly, so they cannot be used to
 * skip the cache.
 */
export const SIGNED_IN_SEGMENT = "signed-in";

const SIGNED_IN_PAGES = [
  /^\/research\/state\/[A-Za-z]{2}$/,
  /^\/research\/district\/\d{1,2}$/,
  /^\/research\/national-fee-index$/,
];

function hasSignedSession(sessionCookie: string | undefined): boolean {
  if (!sessionCookie) return false;
  try {
    return verifyAndExtractSessionId(sessionCookie) !== null;
  } catch {
    // No cookie secret configured: treat the reader as signed out and serve the cached page.
    return false;
  }
}

/** The per-request route for a signed-in reader of a cached page, or null to serve the cached page. */
export function signedInVariantPath(pathname: string, sessionCookie: string | undefined): string | null {
  if (!SIGNED_IN_PAGES.some((page) => page.test(pathname))) return null;
  return hasSignedSession(sessionCookie) ? `${pathname}/${SIGNED_IN_SEGMENT}` : null;
}

/** True for a direct request to a `/signed-in` route, which only the proxy's rewrite may reach. */
export function isSignedInVariantPath(pathname: string): boolean {
  if (!pathname.endsWith(`/${SIGNED_IN_SEGMENT}`)) return false;
  const page = pathname.slice(0, -(SIGNED_IN_SEGMENT.length + 1));
  return SIGNED_IN_PAGES.some((pattern) => pattern.test(page));
}

/**
 * The cached route for a city page's metro view: /fees/city/tx/austin?area=metro is served by
 * /fees/city/tx/austin/metro, because a cached page cannot read its query string. The table's
 * `fee` and `sort` parameters are read in the browser and need no route of their own.
 */
export function cityMetroPath(pathname: string, search: URLSearchParams): string | null {
  if (search.get("area") !== "metro") return null;
  return /^\/fees\/city\/[A-Za-z]{2}\/[^/]+$/.test(pathname) ? `${pathname}/metro` : null;
}

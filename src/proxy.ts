import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { cityMetroPath, isSignedInVariantPath, signedInVariantPath } from "@/lib/viewer-variant";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";

const FEE_CATEGORIES = new Set<string>(Object.values(FEE_FAMILIES).flat());
/** The directory's filters; any one of them makes the view per request. */
const DIRECTORY_FILTER_KEYS = ["q", "state", "charter", "page", "fee", "fees"];

/**
 * The cached route that serves a public address whose query string changes the page (#1811).
 * The profile and the directory are cached (ISR), and a cached page cannot read its query
 * string, so the variants live at their own paths: /institution/82?fee=nsf is served by
 * /institution/82/fee/nsf (also cached) and a filtered directory by /institutions/results.
 * The address in the browser keeps its query string. Null when no rewrite applies.
 */
export function cachedVariantPath(pathname: string, search: URLSearchParams): string | null {
  const profile = /^\/institution\/(\d+)$/.exec(pathname);
  if (profile) {
    const fee = search.get("fee");
    return fee && FEE_CATEGORIES.has(fee) ? `/institution/${profile[1]}/fee/${fee}` : null;
  }
  if (pathname === "/institutions" && DIRECTORY_FILTER_KEYS.some((key) => search.get(key))) {
    return "/institutions/results";
  }
  return null;
}

function requestHeadersWithPath(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const pathWithSearch = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  requestHeaders.set("x-invoke-path", pathWithSearch);
  requestHeaders.set("x-next-url", pathWithSearch);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  return requestHeaders;
}

function isRouteBranch(pathname: string, branch: string) {
  return pathname === branch || pathname.startsWith(`${branch}/`);
}

/** Retired public paths -> their current homes (exact-path, permanent). */
const LEGACY_PATH_REDIRECTS: Record<string, string> = {
  "/consumer": "/institutions",
  "/check": "/institutions",
  "/districts": "/research#districts",
  "/waitlist": "/for-institutions#report",
  // Typed and drafted often; the site's own links go to /subscribe.
  "/pricing": "/subscribe",
};

function permanentRedirectStatus(method: string) {
  return method === "GET" || method === "HEAD" ? 301 : 308;
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const { pathname } = request.nextUrl;

  // Domain redirects: old domains -> feeinsight.com
  if (
    host.includes("bankfeeindex.com") ||
    host.includes("thebankfeeindex.com")
  ) {
    const url = new URL(request.url);
    url.hostname = "feeinsight.com";
    url.port = "";
    url.protocol = "https:";
    return NextResponse.redirect(url, permanentRedirectStatus(request.method));
  }

  // Every route name is lowercase; /INSTITUTION/496 rendered a duplicate page with an
  // uppercase canonical. Only the first segment is folded: later ones can be real values
  // such as the state code in /research/state/TX.
  const firstSegment = pathname.split("/")[1] ?? "";
  if (firstSegment !== firstSegment.toLowerCase() && !firstSegment.includes(".")) {
    const url = request.nextUrl.clone();
    url.pathname = `/${firstSegment.toLowerCase()}${pathname.slice(firstSegment.length + 1)}`;
    return NextResponse.redirect(url, permanentRedirectStatus(request.method));
  }

  const legacyTarget = LEGACY_PATH_REDIRECTS[pathname];
  if (legacyTarget) {
    const url = new URL(legacyTarget, request.url);
    return NextResponse.redirect(url, permanentRedirectStatus(request.method));
  }

  // Skip login page itself
  if (pathname === "/admin/login") {
    const requestHeaders = requestHeadersWithPath(request);
    requestHeaders.set("x-bfi-admin-login-route", "1");
    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  }

  // Check for session cookie on all /admin routes.
  if (isRouteBranch(pathname, "/admin")) {
    const session = request.cookies.get("fsh_session");
    if (!session?.value) {
      const loginUrl = new URL("/admin/login", request.url);
      loginUrl.searchParams.set("from", `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }
  }

  // No-session Pro routes should redirect before App Router rendering so
  // institution-specific return paths do not depend on streamed meta redirects.
  if (isRouteBranch(pathname, "/pro")) {
    const session = request.cookies.get("fsh_session");
    if (!session?.value) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("from", `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Cached pages' per-request and query-string routes (#1811, see viewer-variant.ts).
  if (isSignedInVariantPath(pathname)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const variant =
    cachedVariantPath(pathname, request.nextUrl.searchParams) ??
    signedInVariantPath(pathname, request.cookies.get(SESSION_COOKIE)?.value) ??
    cityMetroPath(pathname, request.nextUrl.searchParams);
  if (variant) {
    const url = request.nextUrl.clone();
    url.pathname = variant;
    return NextResponse.rewrite(url, { request: { headers: requestHeadersWithPath(request) } });
  }

  return NextResponse.next({
    request: { headers: requestHeadersWithPath(request) },
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|sitemap.xml|robots.txt|manifest.webmanifest).*)",
  ],
};

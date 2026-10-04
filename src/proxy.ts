import { NextRequest, NextResponse } from "next/server";

function requestHeadersWithPath(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  // Internal routing hint: only the proxy may set it. A client-sent copy would
  // let any /admin page skip the admin layout's auth check.
  requestHeaders.delete("x-bfi-admin-login-route");
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
  "/districts": "/research",
  "/waitlist": "/for-institutions#report",
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

  return NextResponse.next({
    request: { headers: requestHeadersWithPath(request) },
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|sitemap.xml|robots.txt|manifest.webmanifest).*)",
  ],
};

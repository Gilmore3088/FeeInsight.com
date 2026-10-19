import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";
import { signSessionId } from "@/lib/session-cookie";

function request(
  url: string,
  host = new URL(url).host,
  headers: Record<string, string> = {},
) {
  return new NextRequest(url, {
    headers: {
      host,
      ...headers,
    },
  });
}

describe("proxy", () => {
  it("serves a profile's ?fee= view from its own cached path, keeping the address (#1811)", () => {
    const response = proxy(request("https://feeinsight.com/institution/82?fee=overdraft"));
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://feeinsight.com/institution/82/fee/overdraft?fee=overdraft");

    // An unknown fee is no focus: the plain cached profile answers.
    for (const url of ["https://feeinsight.com/institution/82?fee=nope", "https://feeinsight.com/institution/82?utm_source=x"]) {
      const plain = proxy(request(url));
      expect(plain.headers.get("x-middleware-rewrite")).toBeNull();
      expect(plain.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("serves a filtered directory per request and the plain directory from cache (#1811)", () => {
    for (const query of ["q=chase", "state=TX", "charter=bank", "page=2", "fee=nsf", "fees=1"]) {
      const response = proxy(request(`https://feeinsight.com/institutions?${query}`));
      expect(response.headers.get("x-middleware-rewrite")).toBe(`https://feeinsight.com/institutions/results?${query}`);
    }
    for (const url of [
      "https://feeinsight.com/institutions",
      "https://feeinsight.com/institutions?utm_source=x&q=",
      "https://feeinsight.com/institutions?fees=0",
      "https://feeinsight.com/institutions?fees=yes",
    ]) {
      expect(proxy(request(url)).headers.get("x-middleware-rewrite")).toBeNull();
    }
  });

  it("folds an uppercase route name to lowercase, keeping later segments and the query", () => {
    const response = proxy(request("https://feeinsight.com/INSTITUTION/496?tab=fees"));
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://feeinsight.com/institution/496?tab=fees");

    const state = proxy(request("https://feeinsight.com/research/state/TX"));
    expect(state.headers.get("x-middleware-next")).toBe("1");
  });

  it("lets public routes reach the App Router", () => {
    const response = proxy(request("https://feeinsight.com/methodology"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("content-type")).toBeNull();
  });

  it("forwards the requested path to App Router layouts", () => {
    const response = proxy(
      request("https://feeinsight.com/pro/research?prompt=competitive-brief&instId=2945", undefined, {
        cookie: "fsh_session=present",
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-invoke-path")).toBe(
      "/pro/research?prompt=competitive-brief&instId=2945",
    );
    expect(response.headers.get("x-middleware-request-x-pathname")).toBe("/pro/research");
  });

  it("redirects retired public domains to feeinsight.com", () => {
    const response = proxy(request("https://bankfeeindex.com/fees?category=wire"));

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://feeinsight.com/fees?category=wire");
  });

  it("permanently redirects retired public paths to their current homes", () => {
    const cases: Array<[string, string]> = [
      ["https://feeinsight.com/pricing", "https://feeinsight.com/subscribe"],
      ["https://feeinsight.com/districts", "https://feeinsight.com/research#districts"],
      ["https://feeinsight.com/waitlist", "https://feeinsight.com/for-institutions#report"],
    ];
    for (const [from, to] of cases) {
      const response = proxy(request(from));
      expect(response.status, from).toBe(301);
      expect(response.headers.get("location"), from).toBe(to);
    }
  });

  it("does not redirect nested or similarly named routes as legacy paths", () => {
    for (const path of ["/pro/districts", "/research/district/2", "/check", "/checkout", "/consumer", "/consumers"]) {
      const response = proxy(
        request(`https://feeinsight.com${path}`, undefined, { cookie: "fsh_session=present" }),
      );
      expect(response.headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("redirects unauthenticated admin routes to login", () => {
    const response = proxy(request("https://feeinsight.com/admin/knox?queue=fees"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://feeinsight.com/admin/login?from=%2Fadmin%2Fknox%3Fqueue%3Dfees",
    );
  });

  it("rejects a forged admin cookie even with the old login marker", () => {
    const response = proxy(request("https://feeinsight.com/admin/quality?tab=sources", undefined, {
      cookie: "fsh_session=arbitrary-unsigned-value",
      "x-bfi-admin-login-route": "1",
      "x-pathname": "/admin/login",
    }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://feeinsight.com/admin/login?from=%2Fadmin%2Fquality%3Ftab%3Dsources",
    );
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  it("strips the old login marker before forwarding a signed cookie to live authorization", () => {
    const response = proxy(request("https://feeinsight.com/admin/quality", undefined, {
      cookie: `fsh_session=${signSessionId("a".repeat(64))}`,
      "x-bfi-admin-login-route": "1",
      "x-pathname": "/admin/login",
    }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-bfi-admin-login-route")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-pathname")).toBe("/admin/quality");
    expect(response.headers.get("x-middleware-override-headers")).not.toContain("x-bfi-admin-login-route");
  });

  it("strips the legacy login marker on rewritten public requests too", () => {
    const response = proxy(request("https://feeinsight.com/institutions?q=chase", undefined, {
      "x-bfi-admin-login-route": "1",
    }));
    expect(response.headers.get("x-middleware-rewrite")).toContain("/institutions/results");
    expect(response.headers.get("x-middleware-request-x-bfi-admin-login-route")).toBeNull();
  });

  it("redirects legacy admin login to shared login with a safe return path", () => {
    for (const [from, expected] of [
      ["", "/admin"],
      ["/admin/quality?tab=sources", "/admin/quality?tab=sources"],
      ["https://evil.example/steal", "/admin"],
      ["//evil.example/steal", "/admin"],
      ["/\\evil.example/steal", "/admin"],
    ]) {
      const url = new URL("https://feeinsight.com/admin/login");
      if (from) url.searchParams.set("from", from);
      const response = proxy(request(url.toString(), undefined, { "x-bfi-admin-login-route": "1" }));
      const destination = new URL(response.headers.get("location")!);
      expect(response.status).toBe(307);
      expect(destination.origin + destination.pathname).toBe("https://feeinsight.com/login");
      expect(destination.searchParams.get("from")).toBe(expected);
      expect(response.headers.get("x-middleware-next")).toBeNull();
    }
  });

  it("does not treat similarly named public routes as admin routes", () => {
    const response = proxy(request("https://feeinsight.com/administer"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects unauthenticated Pro routes to login with the full return path", () => {
    const response = proxy(
      request("https://feeinsight.com/pro/analyze?instId=2945&intent=institution"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://feeinsight.com/login?from=%2Fpro%2Fanalyze%3FinstId%3D2945%26intent%3Dinstitution",
    );
  });

  it("does not treat similarly named public routes as Pro routes", () => {
    const response = proxy(request("https://feeinsight.com/products"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
  it("rewrites a signed-in reader of a cached research page to its per-request route (#1811)", async () => {
    const { signSessionId } = await import("@/lib/session-cookie");
    const signedIn = proxy(
      request("https://feeinsight.com/research/state/TX", "feeinsight.com", { cookie: `fsh_session=${signSessionId("b".repeat(64))}` }),
    );
    expect(signedIn.headers.get("x-middleware-rewrite")).toBe("https://feeinsight.com/research/state/TX/signed-in");

    const signedOut = proxy(request("https://feeinsight.com/research/state/TX"));
    expect(signedOut.headers.get("x-middleware-rewrite")).toBeNull();
    expect(signedOut.headers.get("x-middleware-next")).toBe("1");
  });

  it("answers 404 to a direct request for a per-request route, so it cannot skip the cache", () => {
    expect(proxy(request("https://feeinsight.com/research/national-fee-index/signed-in")).status).toBe(404);
  });

  it("serves a city's metro view from its cached route, keeping the address", () => {
    const response = proxy(request("https://feeinsight.com/fees/city/tx/austin?area=metro&fee=nsf"));
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://feeinsight.com/fees/city/tx/austin/metro?area=metro&fee=nsf");
  });
});

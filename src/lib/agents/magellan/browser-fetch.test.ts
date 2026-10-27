import { describe, expect, it } from "vitest";

import {
  BROWSER_DAILY_CAP_DEFAULT,
  browserDailyCap,
  browserFetchEnabled,
  browserMayRequest,
  renderedResponse,
  runBrowserFetch,
  type LaunchBrowser,
  type ResolveHost,
  type RouteHandler,
} from "./browser-fetch";

/** Public answers for every name except the ones that point inward. */
const resolve: ResolveHost = async (host) => [{ address: host === "rebind.example" ? "127.0.0.1" : "93.184.216.34" }];

function fakeBrowser(page: { status?: number; contentType?: string; html?: string; body?: Buffer; expanded?: number; scriptRequests?: string[]; redirectTo?: string }) {
  const seen = { routed: [] as string[], aborted: [] as string[], userAgent: "", closed: 0 };
  const launch: LaunchBrowser = async () => ({
    async newContext(options) {
      seen.userAgent = options.userAgent;
      return {
        async newPage() {
          let handler: RouteHandler = async () => undefined;
          const listeners: Array<(request: { url(): string }) => void> = [];
          let finalUrl = "";
          return {
            async route(_pattern: string, h: RouteHandler) { handler = h; },
            on(_event: "request", listener: (request: { url(): string }) => void) { listeners.push(listener); },
            async goto(url: string) {
              finalUrl = page.redirectTo ?? url;
              const requests: Array<readonly [string, string]> = [[url, "document"], ["https://cdn.example/logo.png", "image"], ["https://bank.example/api/fees", "xhr"], ...(page.scriptRequests ?? []).map((u) => [u, "xhr"] as const)];
              for (const [request] of requests) for (const listener of listeners) listener({ url: () => request });
              // Like Playwright, a redirect hop fires "request" but never reaches the route handler.
              if (page.redirectTo) for (const listener of listeners) listener({ url: () => page.redirectTo! });
              for (const [request, type] of requests) {
                await handler({
                  request: () => ({ url: () => request, resourceType: () => type }),
                  abort: async () => { seen.aborted.push(request); },
                  continue: async () => { seen.routed.push(request); },
                });
              }
              return { status: () => page.status ?? 200, url: () => finalUrl, headers: () => ({ "content-type": page.contentType ?? "text/html" }), body: async () => page.body ?? Buffer.from("") };
            },
            async waitForLoadState() {},
            async evaluate() { return (page.expanded ?? 0) as never; },
            async content() { return page.html ?? "<html></html>"; },
            url: () => finalUrl,
          };
        },
        async close() { seen.closed += 1; },
      };
    },
    async close() { seen.closed += 1; },
  });
  return { launch, seen };
}

describe("Magellan browser step switches", () => {
  it("is off unless MAGELLAN_BROWSER=on, with a 50-a-day cap by default", () => {
    expect(browserFetchEnabled({})).toBe(false);
    expect(browserFetchEnabled({ MAGELLAN_BROWSER: "ON " })).toBe(true);
    expect(browserDailyCap({})).toBe(BROWSER_DAILY_CAP_DEFAULT);
    expect(browserDailyCap({ MAGELLAN_BROWSER_DAILY_CAP: "10" })).toBe(10);
    expect(browserDailyCap({ MAGELLAN_BROWSER_DAILY_CAP: "-3" })).toBe(BROWSER_DAILY_CAP_DEFAULT);
  });

  it("does nothing, and touches no database, while off", async () => {
    const db = (() => { throw new Error("no query expected"); }) as never;
    const result = await runBrowserFetch({ runId: 1, db, env: {} });
    expect(result).toMatchObject({ enabled: false, selected: 0, stored: 0 });
  });
});

describe("what the rendering browser may request", () => {
  it("allows public web addresses and refuses private ones and other schemes", () => {
    expect(browserMayRequest("https://www.bank.example/fees")).toBe(true);
    expect(browserMayRequest("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(browserMayRequest("http://127.0.0.1:3000/")).toBe(false);
    expect(browserMayRequest("http://10.0.0.5/")).toBe(false);
    expect(browserMayRequest("http://[::1]/")).toBe(false);
    expect(browserMayRequest("http://localhost/")).toBe(false);
    expect(browserMayRequest("file:///etc/passwd")).toBe(false);
    expect(browserMayRequest("not a url")).toBe(false);
  });
});

describe("renderedResponse", () => {
  it("returns the rendered page as HTML under our own bot name", async () => {
    const { launch, seen } = fakeBrowser({ html: "<html><table><tr><td>Overdraft fee</td><td>$32</td></tr></table></html>", expanded: 2 });
    const response = await renderedResponse("https://bank.example/fee-schedule", launch, resolve);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.statusText).toBe("rendered, 2 sections opened");
    expect(await response.text()).toContain("Overdraft fee");
    expect(seen.userAgent).toMatch(/^FeeInsightBot\/1\.0 \(Magellan;/);
    // Images are skipped.
    expect(seen.aborted).toEqual(["https://cdn.example/logo.png"]);
    expect(seen.routed).toEqual(["https://bank.example/fee-schedule", "https://bank.example/api/fees"]);
    expect(seen.closed).toBe(2);
  });

  it("keeps a PDF the address serves as its bytes", async () => {
    const { launch } = fakeBrowser({ contentType: "application/pdf", body: Buffer.from("%PDF-1.7") });
    const response = await renderedResponse("https://bank.example/fees.pdf", launch, resolve);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("%PDF-1.7");
  });

  it("never starts a browser for a private address", async () => {
    const launch: LaunchBrowser = async () => { throw new Error("should not launch"); };
    const response = await renderedResponse("http://192.168.1.1/fees", launch, resolve);
    expect(response.status).toBe(400);
    const named = await renderedResponse("https://rebind.example/fees", launch, resolve);
    expect(named.status).toBe(400);
  });

  it("throws the render away when a script reaches for a private address", async () => {
    const { launch, seen } = fakeBrowser({ html: "<html>secret</html>", scriptRequests: ["http://169.254.169.254/latest", "https://rebind.example/x"] });
    const response = await renderedResponse("https://bank.example/fee-schedule", launch, resolve);
    expect(response.status).toBe(400);
    expect(seen.aborted).toContain("http://169.254.169.254/latest");
    expect(seen.aborted).toContain("https://rebind.example/x");
  });

  it("throws the render away when a redirect leads inward", async () => {
    const { launch } = fakeBrowser({ html: "<html>internal</html>", redirectTo: "http://10.0.0.5/admin" });
    const response = await renderedResponse("https://bank.example/fee-schedule", launch, resolve);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("internal");
  });
});

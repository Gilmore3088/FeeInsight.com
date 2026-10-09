import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GSC_NOT_CONFIGURED,
  GSC_SCOPE,
  GSC_TOKEN_URL,
  pagesFrom,
  readSearchWeek,
  searchAnalyticsUrl,
  searchConsoleConfigured,
  searchForScore,
  searchWindows,
  signServiceAccountJwt,
  summarizeSearch,
  totalsFrom,
  type FetchLike,
} from "./search-console";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const KEY_JSON = JSON.stringify({ type: "service_account", client_email: "gsc-reader@fee-insight.iam.gserviceaccount.com", private_key: PRIVATE_PEM });
const NOW = new Date("2026-10-09T13:07:00Z");

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Answers the token exchange, then each Search Analytics query from `answers` in order. */
function fakeFetcher(answers: Response[], token: Response = json(200, { access_token: "ya29.test", expires_in: 3600 })) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const queue = [token, ...answers];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected call to ${url}`);
    return next;
  });
  return { fetcher: fetcher as unknown as FetchLike, calls };
}

beforeEach(() => {
  vi.stubEnv("GSC_SERVICE_ACCOUNT_JSON", KEY_JSON);
  vi.stubEnv("GSC_SITE_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Search Console token", () => {
  it("signs an RS256 JWT for the read-only webmasters scope that the key's public half verifies", () => {
    const jwt = signServiceAccountJwt({ client_email: "a@b.iam.gserviceaccount.com", private_key: PRIVATE_PEM }, NOW);
    const [header, claims, signature] = jwt.split(".");
    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    const iat = Math.floor(NOW.getTime() / 1000);
    expect(decode(claims)).toEqual({ iss: "a@b.iam.gserviceaccount.com", scope: GSC_SCOPE, aud: GSC_TOKEN_URL, iat, exp: iat + 3600 });
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });
});

describe("Search Console windows", () => {
  it("ends this week 3 days before the run and puts the week before right ahead of it", () => {
    expect(searchWindows(NOW)).toEqual({
      thisWeek: { startDate: "2026-09-30", endDate: "2026-10-06" },
      weekBefore: { startDate: "2026-09-23", endDate: "2026-09-29" },
    });
  });
});

describe("aggregation", () => {
  it("reads totals from the single no-dimension row and has no position for a week with no impressions", () => {
    const window = { startDate: "2026-09-30", endDate: "2026-10-06" };
    expect(totalsFrom([{ clicks: 12, impressions: 340, ctr: 0.035, position: 18.4321 }], window)).toEqual({ ...window, clicks: 12, impressions: 340, averagePosition: 18.4 });
    expect(totalsFrom([], window)).toEqual({ ...window, clicks: 0, impressions: 0, averagePosition: null });
  });

  it("keeps the top 10 pages by clicks", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ keys: [`https://feeinsight.com/p${i}`], clicks: i, impressions: 100 + i, position: 10 }));
    const pages = pagesFrom(rows);
    expect(pages).toHaveLength(10);
    expect(pages[0]).toEqual({ page: "https://feeinsight.com/p11", clicks: 11, impressions: 111, averagePosition: 10 });
    expect(pages.at(-1)?.page).toBe("https://feeinsight.com/p2");
  });
});

describe("readSearchWeek", () => {
  it("exchanges the JWT for a token and sends three queries to the encoded site", async () => {
    const { fetcher, calls } = fakeFetcher([
      json(200, { rows: [{ clicks: 12, impressions: 340, ctr: 0.035, position: 18.43 }] }),
      json(200, { rows: [{ clicks: 7, impressions: 210, ctr: 0.033, position: 22.06 }] }),
      json(200, { rows: [{ keys: ["https://feeinsight.com/"], clicks: 9, impressions: 100, position: 5.21 }] }),
    ]);
    const report = await readSearchWeek({ fetcher, now: NOW });

    expect(calls[0].url).toBe(GSC_TOKEN_URL);
    expect(calls[0].init?.method).toBe("POST");
    const form = new URLSearchParams(String(calls[0].init?.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(decode(form.get("assertion")!.split(".")[1])).toMatchObject({ iss: "gsc-reader@fee-insight.iam.gserviceaccount.com", scope: GSC_SCOPE });

    const queryUrl = "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Afeeinsight.com/searchAnalytics/query";
    expect(searchAnalyticsUrl("sc-domain:feeinsight.com")).toBe(queryUrl);
    expect(calls.slice(1).map((call) => call.url)).toEqual([queryUrl, queryUrl, queryUrl]);
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe("Bearer ya29.test");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ startDate: "2026-09-30", endDate: "2026-10-06", type: "web" });
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ startDate: "2026-09-23", endDate: "2026-09-29", type: "web" });
    expect(JSON.parse(String(calls[3].init?.body))).toEqual({ startDate: "2026-09-30", endDate: "2026-10-06", type: "web", dimensions: ["page"], rowLimit: 10 });

    expect(report).toEqual({
      site: "sc-domain:feeinsight.com",
      lagNote: "Search Console data lags about 3 days, so this week ends 2026-10-06, 3 days before the run.",
      thisWeek: { startDate: "2026-09-30", endDate: "2026-10-06", clicks: 12, impressions: 340, averagePosition: 18.4 },
      weekBefore: { startDate: "2026-09-23", endDate: "2026-09-29", clicks: 7, impressions: 210, averagePosition: 22.1 },
      topPages: [{ page: "https://feeinsight.com/", clicks: 9, impressions: 100, averagePosition: 5.2 }],
    });
  });

  it("uses GSC_SITE_URL when set", async () => {
    vi.stubEnv("GSC_SITE_URL", "https://feeinsight.com/");
    const { fetcher, calls } = fakeFetcher([json(200, {}), json(200, {}), json(200, {})]);
    const report = await readSearchWeek({ fetcher, now: NOW });
    expect(calls[1].url).toBe("https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Ffeeinsight.com%2F/searchAnalytics/query");
    expect(report.thisWeek.clicks).toBe(0);
    expect(report.topPages).toEqual([]);
  });
});

describe("searchForScore", () => {
  it("says Search Console is not read when no key is set, and calls nothing", async () => {
    vi.stubEnv("GSC_SERVICE_ACCOUNT_JSON", "");
    const { fetcher, calls } = fakeFetcher([]);
    expect(searchConsoleConfigured()).toBe(false);
    const result = await searchForScore({ fetcher, now: NOW });
    expect(result).toEqual({ measured: false, reason: GSC_NOT_CONFIGURED });
    expect(calls).toHaveLength(0);
    expect(summarizeSearch(result)).toBe(`Search: not measured (${GSC_NOT_CONFIGURED})`);
  });

  it("records a refused token exchange as the reason, without throwing or estimating", async () => {
    const { fetcher } = fakeFetcher([], json(400, { error: "invalid_grant", error_description: "Invalid JWT Signature." }));
    const result = await searchForScore({ fetcher, now: NOW });
    expect(result).toEqual({ measured: false, site: "sc-domain:feeinsight.com", reason: "Search Console read failed: Google token exchange answered 400: Invalid JWT Signature." });
  });

  it("records a failed query as the reason", async () => {
    const { fetcher } = fakeFetcher([json(403, { error: { message: "User does not have sufficient permission for site 'sc-domain:feeinsight.com'." } })]);
    const result = await searchForScore({ fetcher, now: NOW });
    expect(result).toMatchObject({ measured: false, reason: expect.stringContaining("Search Console query answered 403: User does not have sufficient permission") });
  });

  it("records a malformed key as the reason", async () => {
    vi.stubEnv("GSC_SERVICE_ACCOUNT_JSON", "{not json");
    const { fetcher, calls } = fakeFetcher([]);
    const result = await searchForScore({ fetcher, now: NOW });
    expect(result).toMatchObject({ measured: false, reason: "Search Console read failed: GSC_SERVICE_ACCOUNT_JSON is not valid JSON." });
    expect(calls).toHaveLength(0);
  });

  it("reads the week when the key is set", async () => {
    const { fetcher } = fakeFetcher([json(200, { rows: [{ clicks: 1, impressions: 2, position: 3 }] }), json(200, {}), json(200, {})]);
    const result = await searchForScore({ fetcher, now: NOW });
    expect(result.measured).toBe(true);
    expect(summarizeSearch(result)).toBe("Search 2026-09-30 to 2026-10-06: 1 clicks (week before 0), 2 impressions (0), average position 3 (n/a).");
  });
});

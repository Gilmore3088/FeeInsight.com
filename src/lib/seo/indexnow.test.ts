import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store", () => ({ getInstitutionIdsWithFeeDates: vi.fn(async () => []) }));

import { INDEXNOW_ENDPOINT, INDEXNOW_KEY, buildIndexNowUrls, runIndexNowPing, summarizeIndexNow } from "./indexnow";

const NOW = new Date("2026-10-08T16:13:00Z");
const SITE = "https://feeinsight.com";
const institutions = [
  { id: 1, last_fee_at: "2026-10-08T10:00:00Z", verified_fee_count: 12 }, // changed, indexable
  { id: 2, last_fee_at: "2026-10-01T10:00:00Z", verified_fee_count: 12 }, // old
  { id: 3, last_fee_at: "2026-10-08T11:00:00Z", verified_fee_count: 2 }, // thin, noindexed
  { id: 4, last_fee_at: null, verified_fee_count: 9 },
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("IndexNow", () => {
  it("serves the key file the engines check", () => {
    const body = readFileSync(join(process.cwd(), "public", `${INDEXNOW_KEY}.txt`), "utf8");
    expect(body.trim()).toBe(INDEXNOW_KEY);
  });

  it("lists only indexable institution pages changed in the window, plus the data pages", () => {
    const { urls, changedInstitutions } = buildIndexNowUrls(institutions, new Date("2026-10-07T15:13:00Z"), SITE);
    expect(changedInstitutions).toBe(1);
    expect(urls).toContain(`${SITE}/institution/1`);
    expect(urls).toContain(`${SITE}/`);
    expect(urls).not.toContain(`${SITE}/institution/2`);
    expect(urls).not.toContain(`${SITE}/institution/3`);
  });

  it("sends nothing when no page changed", async () => {
    const fetchImpl = vi.fn();
    const result = await runIndexNowPing({ now: NOW, siteUrl: SITE, fetchImpl, loadInstitutions: async () => [institutions[1]] });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.skipped).toBe("no pages changed");
  });

  it("does not ping from a preview deployment", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const fetchImpl = vi.fn();
    const result = await runIndexNowPing({ now: NOW, siteUrl: SITE, fetchImpl, loadInstitutions: async () => institutions });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.skipped).toBe("not production (preview)");
  });

  it("posts host, key, key location and the URLs, and reports the result", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const result = await runIndexNowPing({ now: NOW, siteUrl: SITE, fetchImpl, loadInstitutions: async () => institutions });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(INDEXNOW_ENDPOINT);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ host: "feeinsight.com", key: INDEXNOW_KEY, keyLocation: `${SITE}/${INDEXNOW_KEY}.txt` });
    expect(body.urlList).toContain(`${SITE}/institution/1`);
    expect(result.submitted).toBe(body.urlList.length);
    expect(result.error).toBeNull();
    expect(summarizeIndexNow(result)).toContain("Sent");
  });

  it("reports a rejected ping as an error", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const fetchImpl = vi.fn(async () => new Response("Key not valid", { status: 403 }));
    const result = await runIndexNowPing({ now: NOW, siteUrl: SITE, fetchImpl, loadInstitutions: async () => institutions });
    expect(result.submitted).toBe(0);
    expect(result.error).toBe("IndexNow returned HTTP 403 (Key not valid)");
  });
});

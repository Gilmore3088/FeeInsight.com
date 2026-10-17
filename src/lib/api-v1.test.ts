import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import {
  ApiParamError,
  apiError,
  burstLimitError,
  csvField,
  districtParam,
  intParam,
  stateParam,
  toCsv,
  withApiCaching,
} from "./api-v1";

const params = (query: string) => new URLSearchParams(query);

describe("api-v1 params", () => {
  it("validates whole-number ranges", () => {
    expect(intParam(params(""), "page", { fallback: 1, min: 1, max: 10 })).toBe(1);
    expect(intParam(params("page=3"), "page", { fallback: 1, min: 1, max: 10 })).toBe(3);
    expect(() => intParam(params("page=0"), "page", { fallback: 1, min: 1, max: 10 })).toThrow(ApiParamError);
    expect(() => intParam(params("page=abc"), "page", { fallback: 1, min: 1, max: 10 })).toThrow(ApiParamError);
    expect(() => intParam(params("page=-2"), "page", { fallback: 1, min: 1, max: 10 })).toThrow(ApiParamError);
  });

  it("upper-cases two-letter states and rejects anything else", () => {
    expect(stateParam(params("state=tx"))).toBe("TX");
    expect(stateParam(params(""))).toBeNull();
    expect(() => stateParam(params("state=Texas"))).toThrow(ApiParamError);
  });

  it("parses Fed districts 1-12", () => {
    expect(districtParam(params("district=2,7,7"))).toEqual([2, 7]);
    expect(() => districtParam(params("district=13"))).toThrow(ApiParamError);
    expect(() => districtParam(params("district=a"))).toThrow(ApiParamError);
  });
});

describe("api-v1 CSV", () => {
  it("quotes commas and quotes and defuses spreadsheet formulas", () => {
    expect(csvField('ATM "foreign" fee, per use')).toBe('"ATM ""foreign"" fee, per use"');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField(-5)).toBe("-5");
    expect(csvField(null)).toBe("");
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\n1,"x,y"');
  });
});

describe("api-v1 caching", () => {
  const url = "https://feeinsight.com/api/v1/index";

  it("gives a successful response a private max-age and a weak ETag over its body", async () => {
    const response = await withApiCaching(new Request(url), NextResponse.json({ total: 1 }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(response.headers.get("etag")).toMatch(/^W\/"[0-9a-f]{40}"$/);
    await expect(response.json()).resolves.toEqual({ total: 1 });
  });

  it("answers 304 with no body and the same headers when If-None-Match matches", async () => {
    const first = await withApiCaching(new Request(url), NextResponse.json({ total: 1 }));
    const etag = first.headers.get("etag") as string;

    const again = await withApiCaching(
      new Request(url, { headers: { "if-none-match": `"other", ${etag}` } }),
      NextResponse.json({ total: 1 }, { headers: { "X-RateLimit-Remaining": "41" } }),
    );

    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("etag")).toBe(etag);
    expect(again.headers.get("cache-control")).toBe("private, max-age=300");
    expect(again.headers.get("x-ratelimit-remaining")).toBe("41");
  });

  it("serves the full body again when the data changed", async () => {
    const first = await withApiCaching(new Request(url), NextResponse.json({ total: 1 }));

    const changed = await withApiCaching(
      new Request(url, { headers: { "if-none-match": first.headers.get("etag") as string } }),
      NextResponse.json({ total: 2 }),
    );

    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(first.headers.get("etag"));
  });

  it("tags CSV bodies too", async () => {
    const csv = new NextResponse("a,b\n1,2", { headers: { "Content-Type": "text/csv" } });

    const response = await withApiCaching(new Request(url), csv);

    expect(response.headers.get("etag")).toMatch(/^W\//);
    expect(await response.text()).toBe("a,b\n1,2");
  });

  it("never caches errors", async () => {
    const error = apiError(404, "not_found", "Institution not found");
    const cached = await withApiCaching(new Request(url, { headers: { "if-none-match": "*" } }), error);

    expect(cached.status).toBe(404);
    expect(cached.headers.get("cache-control")).toBe("no-store");
    expect(cached.headers.get("etag")).toBeNull();
  });
});

describe("api-v1 burst error", () => {
  it("states the per-minute limit and sets Retry-After to the seconds left in the minute", async () => {
    const response = burstLimitError(
      { allowed: false, remaining: 0, limit: 60, reset: new Date("2026-10-17T12:01:00.000Z") },
      new Date("2026-10-17T12:00:23.400Z"),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("37");
    await expect(response.json()).resolves.toMatchObject({ code: "burst_limited", limit: 60 });
  });
});

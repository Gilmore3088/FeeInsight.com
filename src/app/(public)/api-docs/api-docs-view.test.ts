import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import {
  ACCESS_LABEL,
  API_ENDPOINTS,
  API_ERRORS,
  COPY,
  coverageStrip,
  curlFor,
  fullPath,
  keyTiers,
  liveFeesSample,
  liveResponseNote,
  paramNote,
  responseShape,
  routeFileFor,
} from "./api-docs-view";

const ROOT = resolve(__dirname, "../../../..");
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");
/** Source with digit separators removed, so `100_000` reads as `100000`. */
const plain = (source: string) => source.replace(/(\d)_(\d)/g, "$1$2");

const V1_HELPERS = ["src/lib/api-v1.ts", "src/lib/api-v1-auth.ts", "src/lib/api-auth.ts"].map(read).join("\n");

const LIMITS = { free: 100, pro: 10_000, enterprise: Infinity };

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

function visibleStrings(): string[] {
  const tiers = keyTiers({ spotlightCount: 6, categoriesLabel: "49", limits: LIMITS });
  return collectStrings([
    COPY,
    ACCESS_LABEL,
    API_ERRORS,
    tiers,
    liveResponseNote(6),
    coverageStrip(
      { institutionsLabel: "1", observationsLabel: "2", categoriesLabel: "3", statesLabel: "4" },
      { institutions: "a", observations: "b", categories: "c" },
    ),
    API_ENDPOINTS.map((e) => [e.summary, fullPath(e), e.params.map((p) => [p.name, p.type, paramNote(p)]), responseShape(e.fields)]),
  ]);
}

describe("api-docs endpoint list matches the route code", () => {
  it("every documented path has a route file that exports its method", () => {
    for (const endpoint of API_ENDPOINTS) {
      const file = routeFileFor(endpoint);
      expect(existsSync(resolve(ROOT, file)), file).toBe(true);
      expect(read(file), `${file} exports ${endpoint.method}`).toMatch(new RegExp(`export const ${endpoint.method}\\b`));
    }
  });

  it("every v1 route file is documented", () => {
    const documented = new Set(API_ENDPOINTS.map(routeFileFor));
    for (const dir of ["fees", "index", "institutions", "revenue", "fee-changes", "branches", "market", "mcp", "openapi.json"]) {
      expect(documented.has(`src/app/api/v1/${dir}/route.ts`), dir).toBe(true);
    }
  });

  it("every parameter is one the route (or the shared v1 helpers) reads", () => {
    for (const endpoint of API_ENDPOINTS) {
      const source = read(routeFileFor(endpoint)) + V1_HELPERS;
      for (const param of endpoint.params) {
        expect(source, `${endpoint.id} ${param.name}`).toContain(`"${param.name}"`);
      }
    }
  });

  it("stated defaults and maximums are the route's own intParam bounds", () => {
    let checked = 0;
    for (const endpoint of API_ENDPOINTS) {
      const source = plain(read(routeFileFor(endpoint)));
      for (const param of endpoint.params) {
        if (!param.bounds) continue;
        const { fallback, min, max } = param.bounds;
        expect(source, `${endpoint.id} ${param.name}`).toContain(`"${param.name}", { fallback: ${fallback}, min: ${min}, max: ${max} }`);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("every top-level response field is written by the route", () => {
    for (const endpoint of API_ENDPOINTS) {
      const source = read(routeFileFor(endpoint));
      for (const field of endpoint.fields) {
        const top = field.name.split(".")[0].replace("[]", "");
        expect(source, `${endpoint.id} ${field.name}`).toMatch(new RegExp(`\\b${top}\\b`));
      }
    }
  });

  it("every error code is returned with that status somewhere in the v1 code", () => {
    const sources = [
      ...API_ENDPOINTS.map((e) => read(routeFileFor(e))),
      V1_HELPERS,
      read("src/lib/api-v1-mcp.ts"),
    ].join("\n");
    for (const error of API_ERRORS) {
      const direct = sources.includes(`apiError(${error.status}, "${error.code}"`);
      expect(direct, `${error.status} ${error.code}`).toBe(true);
    }
  });

  it("the tier limits shown are the rate limiter's constants", async () => {
    const source = plain(read("src/lib/api-rate-limit.ts"));
    expect(source).toContain(`free: ${LIMITS.free},`);
    expect(source).toContain(`pro: ${LIMITS.pro},`);
    expect(source).toContain("enterprise: Infinity,");
  });
});

describe("api-docs visible copy", () => {
  it("has no em or en dashes", () => {
    for (const text of visibleStrings()) expect(text, text).not.toMatch(/[–—]/);
  });

  it("never names a pipeline agent or Frost Bank", () => {
    const banned = /\b(Atlas|Magellan|Rosetta|Knox|Darwin|Deming|Frost)\b/;
    for (const text of visibleStrings()) expect(text, text).not.toMatch(banned);
  });

  it("names the data as the Bank Fee Index", () => {
    expect(COPY.title).toContain("Bank Fee Index");
  });
});

describe("api-docs helpers", () => {
  it("keyTiers reads allowances from the limits passed in; enterprise is unlimited", () => {
    const tiers = keyTiers({ spotlightCount: 6, categoriesLabel: "49", limits: LIMITS });
    expect(tiers.map((t) => t.allowance)).toEqual(["100", "10,000", "Unlimited"]);
    expect(tiers[0].categories).toBe("6 spotlight");
    expect(tiers[1].categories).toBe("All 49");
    const open = API_ENDPOINTS.filter((e) => e.access !== "pro").length;
    expect(tiers[0].endpoints).toBe(`${open} of ${API_ENDPOINTS.length}`);
  });

  it("paramNote states bounds only when the route has them", () => {
    expect(paramNote({ name: "limit", type: "integer", note: "Rows per page", bounds: { fallback: 50, min: 1, max: 200 } })).toBe(
      "Rows per page. Default 50, up to 200",
    );
    expect(paramNote({ name: "q", type: "string", note: "Name search" })).toBe("Name search");
  });

  it("fullPath and curlFor build the request a partner sends", () => {
    expect(fullPath({ path: "/fees", query: "category={key}" })).toBe("/api/v1/fees?category={key}");
    expect(curlFor("https://feeinsight.com", "/api/v1/fees")).toBe(
      'curl -H "Authorization: Bearer bfi_your_key" \\\n  https://feeinsight.com/api/v1/fees',
    );
  });

  it("responseShape nests array and object fields and shows types, not figures", () => {
    const shape = responseShape([
      { name: "total", type: "integer" },
      { name: "data[].median", type: "number | null" },
      { name: "summary.count", type: "integer" },
    ]);
    expect(shape).toBe(
      '{\n  "total": integer,\n  "data": [{\n    "median": number | null\n  }, ...],\n  "summary": {\n    "count": integer\n  }\n}',
    );
    expect(shape).not.toMatch(/\d/);
  });

  const row = (fee_category: string, median: number): FeeCategorySummary =>
    ({
      fee_category,
      institution_count: 12,
      total_observations: 20,
      min_amount: 1,
      max_amount: 40,
      avg_amount: 20,
      median_amount: median,
      p25_amount: 10,
      p75_amount: 30,
      bank_count: 6,
      cu_count: 6,
      zero_count: 0,
      bank_median_amount: null,
      cu_median_amount: null,
    }) as unknown as FeeCategorySummary;

  it("liveFeesSample keeps the spotlight rows the free key gets and shows the first", () => {
    const sample = liveFeesSample(
      [row("wire_domestic_outgoing", 25), row("overdraft", 35), row("nsf", 32)],
      ["overdraft", "nsf"],
      { text: "Source", url: "https://feeinsight.com" },
    );
    expect(sample?.total).toBe(2);
    const parsed = JSON.parse(sample!.json.replace(",\n    ...", ""));
    expect(parsed.total).toBe(2);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0]).toMatchObject({ category: "overdraft", median: 35, p25: 10, p75: 30, institution_count: 12 });
    expect(parsed.attribution).toEqual({ text: "Source", url: "https://feeinsight.com" });
  });

  it("liveFeesSample is null when the read returned nothing", () => {
    expect(liveFeesSample([], ["overdraft"], { text: "", url: "" })).toBeNull();
  });
});

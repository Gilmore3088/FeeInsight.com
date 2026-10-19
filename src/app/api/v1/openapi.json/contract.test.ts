import Ajv, { type SchemaObject } from "ajv";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeV1 } from "@/lib/api-v1-auth";
import { dateTimeParam } from "@/lib/api-v1";
import { getFeeCategoryDetail, getFeesByInstitution, getInstitutionById, getInstitutionsByFilter } from "@/lib/data-store";
import { getPublicCategorySummaries } from "@/lib/public-stats";
import { searchInstitutions } from "@/lib/data-store/search";
import { getInstitutionBenchmark, type InstitutionBenchmark } from "@/lib/data-store/benchmark-export";
import { getRegulatoryWatch, type RegulatoryWatch } from "@/lib/data-store/regulatory-watch";
import { listPublishedFeeRows } from "@/lib/data-store/published-fee-rows";
import { GET as getFees } from "../fees/route";
import { GET as getInstitutions } from "../institutions/route";
import { GET as getSpec } from "./route";

vi.mock("@/lib/api-v1-auth", () => ({ authorizeV1: vi.fn() }));
vi.mock("@/lib/api-usage", () => ({ logApiUsage: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/data-store", () => ({
  getFeeCategoryDetail: vi.fn(),
  getInstitutionById: vi.fn(),
  getFeesByInstitution: vi.fn(() => Promise.resolve([])),
  getInstitutionsByFilter: vi.fn(() => Promise.resolve({ rows: [], total: 0 })),
  getFinancialsByInstitution: vi.fn(() => Promise.resolve([])),
  getComplaintsByInstitution: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@/lib/public-stats", () => ({ getPublicCategorySummaries: vi.fn() }));
vi.mock("@/lib/data-store/search", () => ({ searchInstitutions: vi.fn() }));
vi.mock("@/lib/data-store/benchmark-export", () => ({
  BENCHMARK_CSV_HEADER: [], benchmarkCsvRows: vi.fn(), getInstitutionBenchmark: vi.fn(),
}));
vi.mock("@/lib/data-store/regulatory-watch", () => ({ getRegulatoryWatch: vi.fn() }));
vi.mock("@/lib/data-store/rate-fees", () => ({ getRateFeesByInstitution: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/lib/data-store/published-fee-rows", () => ({ listPublishedFeeRows: vi.fn() }));

interface ApiSpec {
  components: { schemas: Record<string, SchemaObject> };
  paths: Record<string, { get: {
    parameters: { name?: string; schema?: SchemaObject }[];
    responses: Record<string, { content: Record<string, { schema: SchemaObject }> }>;
  } }>;
}

// These are datastore fixtures, passed through the actual API handlers before validation.
const institution = {
  id: 12, institution_name: "Example Bank", state_code: null, city: null,
  charter_type: "bank", asset_size: null, asset_size_tier: null, fed_district: null,
  fee_count: 0, published_fee_count: 0,
};
const group = { median: null, p25: null, p75: null, institutions: 2 };
const benchmark: InstitutionBenchmark = {
  institution: { id: 12, name: "Example Bank", state: null, charter_type: "bank", asset_tier: null },
  groups: { national: "All banks", state: "Banks in the state", asset_peers: "Banks of the same asset size", local_market: null },
  rows: [{
    fee_category: "legal_process", display_name: "Legal process", family: null,
    amount: null, amount_low: 150, amount_high: 175,
    fees: [{ name: "Levy", amount: 150 }, { name: "Garnishment", amount: 175 }],
    national: group, state: group, asset_peers: group,
    local_market: { median: null, institutions: 2 }, position: null, source_url: null,
  }],
  rate_rows: [{
    fee_category: "card_foreign_txn", display_name: "Foreign transaction", family: null,
    rate_percent: 3, rate_terms: "3% of the transaction", national: group, position: null, source_url: null,
  }],
};
const feeTie = {
  fee_category: "legal_process", display_name: "Legal process", amount: null,
  amount_low: 150, amount_high: 175, market_median: null, market_count: 2,
};
const watch: RegulatoryWatch = {
  state: {
    state_code: "TX", state_name: "Texas", supervisor: { agency: "Texas Department of Banking", website: null },
    laws: [{ id: "illustrative-law", name: "Illustrative law", citation: "Example citation", summary: "Illustrative terms", url: null, topic: "fees", fees: [feeTie], all_fees: false }],
    laws_reviewed: true, bills: [], bills_tracked: false,
  },
  market: { places: ["Example County, TX"], peers_checked: 1 },
  peer_actions: [{
    peer_id: 13, peer_name: "Example Peer", agency: "OCC", party_name: "Example Peer",
    against_holding_company: false, action_type: null, subject: null, consumer_law: false,
    theme: "other", no_end_date_on_file: true, start_date: null, termination_date: null,
    penalty_amount: null, document_url: null,
  }],
  fee_focus: [feeTie], agencies_loaded: ["OCC"],
  rule_changes: [{
    source: "federal_register", title: "Illustrative rule", kind: "Proposed Rule", stage: null,
    agencies: ["Example agency"], published_on: null, comments_close_on: null, effective_on: null,
    url: null, topics: ["fees"], fees: [feeTie], all_fees: false,
  }],
  rules_tracked: false, as_of: null,
};

let spec: ApiSpec;
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addFormat("date-time", (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)));

function validator(schema: SchemaObject) {
  return ajv.compile({ ...schema, components: spec.components });
}

function responseValidator(path: string) {
  return validator(spec.paths[path].get.responses["200"].content["application/json"].schema);
}

function assertValid(path: string, body: unknown) {
  const validate = responseValidator(path);
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
}

describe("OpenAPI response contracts", () => {
  beforeAll(async () => {
    spec = await (await getSpec()).json();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authorizeV1).mockResolvedValue({
      auth: { valid: true, organizationId: 3, tier: "pro" }, user: null,
      organizationId: 3, keyId: 1, anonymousId: null, paid: true,
      rateLimit: { allowed: true, limit: 10_000, remaining: 9_999, reset: new Date("2026-11-01T00:00:00Z") },
    });
    vi.mocked(getInstitutionById).mockResolvedValue(institution as never);
    vi.mocked(getInstitutionBenchmark).mockResolvedValue(benchmark);
    vi.mocked(getRegulatoryWatch).mockResolvedValue(watch);
    vi.mocked(getInstitutionsByFilter).mockResolvedValue({ rows: [institution], total: 1 } as never);
    vi.mocked(searchInstitutions).mockResolvedValue({ rows: [institution], total: 1 } as never);
  });

  it("validates fee lists, including suppressed statistics and empty lists", async () => {
    vi.mocked(getPublicCategorySummaries).mockResolvedValue([{
      fee_category: "overdraft", median_amount: null, p25_amount: null, p75_amount: null,
      min_amount: null, max_amount: null, institution_count: 2,
    }] as never);
    const body = await (await getFees(new NextRequest("https://feeinsight.com/api/v1/fees"))).json();
    assertValid("/fees", body);
    assertValid("/fees", { ...body, total: 0, data: [] });
    expect(responseValidator("/fees")({ ...body, data: [{ ...body.data[0], median: "35" }] })).toBe(false);
  });

  it("validates real category breakdown arrays and rejects the old object shape", async () => {
    const breakdown = [{ dimension_value: "Bank", count: 2, min_amount: 25, max_amount: 35, avg_amount: 30, median_amount: null, p25_amount: null, p75_amount: null }];
    vi.mocked(getFeeCategoryDetail).mockResolvedValue({
      fees: [{ institution_id: 12, amount: 35 }],
      by_charter_type: breakdown, by_asset_tier: [], by_fed_district: [], by_state: [],
    } as never);
    const body = await (await getFees(new NextRequest("https://feeinsight.com/api/v1/fees?category=overdraft"))).json();
    assertValid("/fees", body);
    expect(responseValidator("/fees")({ ...body, by_charter_type: { bank: { median: 30 } } })).toBe(false);
  });

  it.each(["", "?q=Example", "?fee_category=overdraft"])("validates institution list mode %s with nullable registry fields", async (query) => {
    const body = await (await getInstitutions(new NextRequest(`https://feeinsight.com/api/v1/institutions${query}`))).json();
    assertValid("/institutions", body);
    expect(responseValidator("/institutions")({ ...body, data: [{ ...body.data[0], fee_count: "0" }] })).toBe(false);
  });

  it("distinguishes empty institution lists from empty published-fee feeds", async () => {
    vi.mocked(getInstitutionsByFilter).mockResolvedValue({ rows: [], total: 0 });
    vi.mocked(listPublishedFeeRows).mockResolvedValue({ rows: [], total: 0 });
    for (const query of ["", "?view=fees"]) {
      const body = await (await getInstitutions(new NextRequest(`https://feeinsight.com/api/v1/institutions${query}`))).json();
      assertValid("/institutions", body);
    }
    expect(responseValidator("/institutions")({})).toBe(false);
  });

  it("validates detail output with a nullable fee and registry values", async () => {
    vi.mocked(getFeesByInstitution).mockResolvedValue([{
      fee_name: "Overdraft Fee", fee_category: "overdraft", amount: null, frequency: null,
      conditions: null, review_status: "approved", extraction_confidence: 0.9, source_url: null,
      created_at: new Date("2026-10-02T00:00:00Z"),
    }] as never);
    const body = await (await getInstitutions(new NextRequest("https://feeinsight.com/api/v1/institutions?id=12&updated_since=2026-10-01"))).json();
    assertValid("/institutions", body);
    expect(body.updated_since).toBe("2026-10-01T00:00:00.000Z");
    expect(responseValidator("/institutions")({ ...body, fees: "unavailable" })).toBe(false);
  });

  it("validates published-fee row output and rejects string amounts", async () => {
    vi.mocked(listPublishedFeeRows).mockResolvedValue({ total: 1, rows: [{
      fee_id: 501, institution_id: 12, institution_name: "Example Bank", state: null, charter_type: "bank",
      fee_name: "Overdraft Fee", fee_category: "overdraft", amount: 35, frequency: null,
      conditions: null, source_url: null, published_at: "2026-10-02T00:00:00.000Z",
    }] } as never);
    const body = await (await getInstitutions(new NextRequest("https://feeinsight.com/api/v1/institutions?view=fees"))).json();
    assertValid("/institutions", body);
    expect(responseValidator("/institutions")({ ...body, data: [{ ...body.data[0], amount: "35" }] })).toBe(false);
  });

  it("validates benchmark output with multiple dollar amounts and separate rates", async () => {
    const body = await (await getInstitutions(new NextRequest("https://feeinsight.com/api/v1/institutions?id=12&view=benchmark"))).json();
    assertValid("/institutions", body);
    expect(responseValidator("/institutions")({ ...body, rows: [{ ...body.rows[0], amount_low: "150" }] })).toBe(false);
    expect(responseValidator("/institutions")({ ...body, rate_rows: [{ ...body.rate_rows[0], rate_percent: "3" }] })).toBe(false);
  });

  it("validates populated and empty regulatory-watch output", async () => {
    const request = () => new NextRequest("https://feeinsight.com/api/v1/institutions?id=12&view=regulatory_watch");
    const body = await (await getInstitutions(request())).json();
    assertValid("/institutions", body);
    expect(responseValidator("/institutions")({ ...body, peer_actions: [{ ...body.peer_actions[0], penalty_amount: "100" }] })).toBe(false);
    expect(responseValidator("/institutions")({ ...body, rule_changes: [{ ...body.rule_changes[0], all_fees: "false" }] })).toBe(false);
    vi.mocked(getRegulatoryWatch).mockResolvedValue({ ...watch, state: null, market: null, peer_actions: [], fee_focus: [], agencies_loaded: [], rule_changes: [], as_of: null });
    assertValid("/institutions", await (await getInstitutions(request())).json());
  });

  it.each(["/institutions", "/rate-fees"])("accepts supported updated_since forms for %s", (path) => {
    const parameter = spec.paths[path].get.parameters.find((entry) => entry.name === "updated_since");
    const validate = validator(parameter!.schema!);
    for (const value of ["2026-10-01", "2026-10-01T12:30", "2026-10-01T12:30:01", "2026-10-01T12:30:01.123456Z", "2026-10-01T12:30:01-07:00"]) {
      expect(validate(value), value).toBe(true);
      expect(dateTimeParam(new URLSearchParams({ updated_since: value }), "updated_since")).toBeInstanceOf(Date);
    }
    for (const value of ["yesterday", "10/01/2026", "2026-10-01 12:30:00", 123]) {
      expect(validate(value), String(value)).toBe(false);
    }
  });
});

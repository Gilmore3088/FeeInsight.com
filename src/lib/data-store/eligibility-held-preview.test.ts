import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ sql: vi.fn() }));

vi.mock("@/lib/data-store/connection", () => ({
  sql: state.sql,
  getSql: () => state.sql,
}));
vi.mock("@/lib/data-store", () => ({
  getFeeCategorySummaries: vi.fn(),
  getFeeCategoryDetail: vi.fn(),
  getNationalIndex: vi.fn(),
  getPeerIndex: vi.fn(),
  getInstitutionsByFilter: vi.fn(),
  getInstitutionById: async (id: number) => ({
    id,
    institution_name: "Synthetic policy bank",
    state_code: "ZZ",
  }),
  getFeesByInstitution: async () => [{
    id: 34,
    institution_id: 9002,
    fee_name: "NSF/Overdraft Fee",
    fee_category: "nsf",
    amount: 34,
    frequency: "per_item",
    conditions: "Standard policy",
    review_status: "approved",
    source_document_id: 1,
    source_url: "https://example.com/fees",
  }],
  getFinancialsByInstitution: async () => [],
}));
vi.mock("@/lib/data-store/call-reports", () => ({
  getInstitutionPeerRanking: async () => null,
  getInstitutionRevenueTrend: async () => [],
}));

import { getInstitutionFeeScheduleEvidence } from "./institution";

function raw(id: number, held: boolean) {
  return {
    fee_raw_id: id,
    source_document_id: 1,
    fee_name: held ? "NSF/Overdraft Fee" : "Statement Copy",
    amount: held ? 5 : 2,
    frequency: "per_item",
    conditions: held
      ? 'Knox held for review (eligibility) from Rosetta artifact #1. canonical_hint=nsf; text_hash=x; excerpt="NSF/Overdraft Fee $5 for an age/product tier"'
      : "$2 per copy",
    outlier_flags: held
      ? ["knox_review:eligibility", "canonical_hint:nsf"]
      : ["needs_darwin_verification"],
    source: "knox",
    source_url: "https://example.com/fees",
    created_at: "2026-10-19T00:00:00Z",
  };
}

function fixture() {
  return [{
    latest_document: null,
    latest_text: null,
    pipeline_counts: {},
    raw_fee_preview: [raw(5, true), raw(6, false)],
    verified_fee_preview: [],
  }];
}

describe("#2209 eligibility holds stay out of customer provisional raw previews", () => {
  beforeEach(() => {
    state.sql.mockReset();
    state.sql.mockResolvedValue(fixture());
  });

  it("keeps ordinary raw evidence and excludes an eligibility hold in the real evidence mapper", async () => {
    const evidence = await getInstitutionFeeScheduleEvidence(9002);

    expect(evidence.raw_fee_preview.map(row => row.fee_raw_id)).toEqual([6]);
    expect(evidence.raw_fee_preview[0].conditions).toBe("$2 per copy");
    const [strings, ...params] = state.sql.mock.calls.at(-1)!;
    expect(strings.join(" ")).toContain("knox_review:eligibility");
    expect(params).toContain(false);
  });

  it("preserves admin inspection of both raw rows with pipeline notes", async () => {
    const evidence = await getInstitutionFeeScheduleEvidence(9003, { pipelineNotes: true });

    expect(evidence.raw_fee_preview.map(row => row.fee_raw_id)).toEqual([5, 6]);
    expect(evidence.raw_fee_preview[0].conditions).toContain("eligibility");
  });

  it("runs actual getInstitution raw fallback without exposing the scoped $5 price", async () => {
    const { getInstitution } = await import("@/lib/research/tools");
    const output = await getInstitution.execute!(
      { id: 9004 },
      { toolCallId: "eligibility-fixture", messages: [] },
    );
    const fees = (output as {
      fees: {
        verified: Array<{ amount: number }>;
        provisional: Array<{ amount: number }>;
      };
    }).fees;

    expect(fees.verified.map(row => row.amount)).toEqual([34]);
    expect(fees.provisional.map(row => row.amount)).toEqual([2]);
  });

  it.each(["admin-first", "reader-first"] as const)(
    "partitions cached evidence in %s order for the same institution",
    async order => {
      const id = order === "admin-first" ? 9005 : 9006;
      const readAdmin = () => getInstitutionFeeScheduleEvidence(id, { pipelineNotes: true });
      const readReader = () => getInstitutionFeeScheduleEvidence(id);
      const [first, second] = order === "admin-first"
        ? [await readAdmin(), await readReader()]
        : [await readReader(), await readAdmin()];
      const admin = order === "admin-first" ? first : second;
      const reader = order === "admin-first" ? second : first;

      expect(admin.raw_fee_preview.map(row => row.fee_raw_id)).toEqual([5, 6]);
      expect(admin.raw_fee_preview[0].conditions).toContain("Knox held for review");
      expect(reader.raw_fee_preview.map(row => row.fee_raw_id)).toEqual([6]);
      expect(reader.raw_fee_preview[0].conditions).toBe("$2 per copy");
      expect(state.sql).toHaveBeenCalledTimes(2);
      expect(await readAdmin()).toBe(admin);
      expect(await readReader()).toBe(reader);
      expect(state.sql).toHaveBeenCalledTimes(2);
    },
  );
});

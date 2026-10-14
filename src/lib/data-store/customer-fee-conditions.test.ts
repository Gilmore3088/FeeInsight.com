/**
 * #1234 step 3: no customer reader returns Knox's extraction note in `conditions`.
 *
 * Every live fee row the database hands back here carries the note in its real live shape, so a
 * reader that passes `conditions` through without `readerFeeConditions` fails. A new reader of
 * `conditions` for pages, the API, reports or Hamilton belongs in READERS below.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PIPELINE_NOTE_MARKERS } from "@/lib/fee-conditions";

const NOTE =
  'Knox extract.rules v65 read this line again in Rosetta artifact #2817. Knox deterministic extraction from Rosetta artifact #2817. canonical_hint=overdraft; text_hash=dcdfc0bff16f; calibrated_confidence=0.98; excerpt="Overdraft | $25 per item"';
const MIXED = `Waived for members 65 and older. ${NOTE}`;

const feeRow = (conditions: string) => ({
  id: 1,
  fee_raw_id: 1,
  institution_id: 7,
  institution_name: "Example Bank",
  fee_name: "Overdraft",
  fee_category: "overdraft",
  fee_family: "overdraft",
  canonical_fee_key: "overdraft",
  amount: 25,
  frequency: "per_item",
  conditions,
  extraction_confidence: 0.98,
  review_status: "approved",
  validation_flags: [],
  source_url: "https://example.com/fees.pdf",
  document_url: "https://example.com/fees.pdf",
  source_document_id: 3,
  source: "knox",
  created_at: "2026-10-01T00:00:00.000Z",
  fee_audience: "consumer",
  audience_evidence: null,
  fee_treatment: "fee",
  charter_type: "bank",
  state_code: "TX",
  asset_size_tier: "community",
  asset_size: 100,
  fed_district: 11,
  variant_type: null,
  account_product_type: null,
  is_fee_cap: false,
  coverage_tier: null,
  amount_kind: "percent",
  rate_percent: 1.1,
  rate_min_amount: null,
  rate_max_amount: null,
  rate_basis: "transaction",
});

const rows = (query: string) => {
  const fees = [feeRow(NOTE), feeRow(MIXED)];
  // Only queries that select `conditions` get fee rows. The evidence query returns one row of
  // JSON aggregates.
  if (query.includes("COUNT(*) as cnt")) return [{ cnt: fees.length }];
  if (!query.includes("conditions")) return [];
  if (!query.includes("raw_fee_preview")) return fees;
  return [{ latest_document: null, latest_text: null, pipeline_counts: {}, raw_fee_preview: fees, verified_fee_preview: [] }];
};

vi.mock("@/lib/data-store/connection", () => {
  const sql = Object.assign(
    (...args: unknown[]) =>
      Array.isArray(args[0]) && "raw" in (args[0] as object)
        ? Promise.resolve(rows((args[0] as string[]).join(" ")))
        : args[0],
    { unsafe: (query: unknown) => Promise.resolve(rows(String(query))) },
  );
  return { sql, getSql: () => sql };
});

const { getFeesByInstitution, getAllFees } = await import("./core");
const { getInstitutionFees, getInstitutionFeeScheduleEvidence } = await import("./institution");
const { getFeeCategoryDetail } = await import("./fees");
const { getInstitutionFeeRows } = await import("./fee-index");
const { getRateFeesByInstitution } = await import("./rate-fees");
const { toDisplayFees, toPipelineDisplayFees, toRateDisplayFees } = await import(
  "@/app/(public)/institution/[id]/profile-data"
);

/** Every `conditions` value anywhere in a reader's result. */
function conditionsIn(value: unknown, found: unknown[] = []): unknown[] {
  if (Array.isArray(value)) value.forEach((item) => conditionsIn(item, found));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "conditions") found.push(item);
      else conditionsIn(item, found);
    }
  }
  return found;
}

let evidenceId = 100;
const READERS: Array<[string, () => Promise<unknown>]> = [
  ["getFeesByInstitution (institution pages, API v1, Hamilton tools)", () => getFeesByInstitution(7)],
  ["getAllFees", () => getAllFees()],
  ["getInstitutionFees (subscribe benchmark)", () => getInstitutionFees(7)],
  ["getInstitutionFeeScheduleEvidence (pipeline preview, evidence API, reports)", () => getInstitutionFeeScheduleEvidence(evidenceId++)],
  ["getFeeCategoryDetail (fee pages, guides, API v1 fees)", () => getFeeCategoryDetail("overdraft")],
  ["getInstitutionFeeRows (Hamilton research and evidence export)", () => getInstitutionFeeRows(7, "overdraft")],
  ["getRateFeesByInstitution", () => getRateFeesByInstitution(7)],
  ["institution page rows", async () => [
    toDisplayFees(await getFeesByInstitution(7)),
    toPipelineDisplayFees(await getInstitutionFeeScheduleEvidence(evidenceId++)),
    toRateDisplayFees(await getRateFeesByInstitution(7)),
  ]],
];

describe("customer fee readers never return Knox's extraction note (#1234)", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

  it.each(READERS)("%s", async (_name, read) => {
    const conditions = conditionsIn(await read());
    expect(conditions.length).toBeGreaterThan(0);
    for (const value of conditions) {
      expect(typeof value === "string" && PIPELINE_NOTE_MARKERS.test(value)).toBe(false);
    }
    // The bank's own text beside the note survives.
    expect(conditions).toContain("Waived for members 65 and older");
  });

  it("admin pages still see the note when they ask for it", async () => {
    const fees = await getInstitutionFees(7, { pipelineNotes: true });
    expect(fees.map((fee) => fee.conditions)).toContain(NOTE);
  });
});

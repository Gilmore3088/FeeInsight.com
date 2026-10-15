import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/hard-documents.json";
import {
  decidePriorFee,
  linesApartOnPage,
  publishSkipReason,
  sameValueLinesApart,
  type PriorPublishedFeeRow,
  type VerifiedFeeRow,
} from "@/lib/agents/hamilton/publish";
import { nearNameRepeats, type NearNameRow } from "@/lib/agents/hamilton/duplicate-collapse";
import { isProductPage } from "@/lib/agents/hamilton/product-page";
import { CATEGORY_GUARD_VERSION, checkFeeCategory } from "@/lib/fee-category-guard";
import { TAXONOMY_COUNT } from "@/lib/fee-taxonomy";
import { RESEARCH_SPLIT_LIVE } from "@/lib/fee-fold";

/**
 * The hard-document gate (#1067). Real source lines, read from production and cited by document,
 * that every change to the taxonomy, the fold rules, the category guard or the publish-time
 * same-line check must still read the same way. A change that merges two fees at one price, lets
 * two reads of one line through as two fees, publishes a product page's benefit list, or moves a
 * fee in the categories with the most wrong-after-publish takedowns fails here, before release.
 * Pure: no database, no model calls. Cases the rules still get wrong sit under `known_misses` and
 * run as expected failures, so a fix shows up as a failing test that moves the case into the gate.
 */

interface SamePriceCase {
  case_key: string;
  family: "distinct_same_dollar" | "true_duplicate";
  canonical_fee_key: string;
  amount: string;
  source_document_id: number;
  text_hash: string;
  row: { fee_published_id: number; fee_name: string };
  prior: { fee_published_id: number; fee_name: string };
  text: string;
}

interface CategoryCase {
  case_key: string;
  canonical_fee_key: string;
  fee_name: string;
  amount: string;
  source_document_id: number;
  text_hash: string;
  excerpt: string;
  /** "ok", or the guard code that must refuse it ("not_ok" in known misses: any refusal). */
  expected: string;
  document_nsf_amount?: string;
}

interface DocumentCase {
  case_key: string;
  family: "product_page" | "fee_schedule";
  source_document_id: number;
  document_url: string;
  canonical_fee_key: string;
  fee_name: string;
}

interface NearNameCase {
  case_key: string;
  source_document_id: number;
  canonical_fee_key: string;
  amount: string;
  text_of?: string;
  text?: string;
  text_hash?: string;
  rows: Array<Pick<NearNameRow, "fee_published_id" | "fee_name" | "frequency" | "fee_audience" | "published_at">>;
  closed: number[];
  kept: number | null;
}

interface HardDocuments {
  measured: { top_categories: Array<{ canonical_fee_key: string; wrong: number }> };
  same_price: SamePriceCase[];
  category: CategoryCase[];
  documents: DocumentCase[];
  near_name: { cases: NearNameCase[] };
  known_misses: { same_price: SamePriceCase[]; category: CategoryCase[] };
}

const hard = fixture as unknown as HardDocuments;
const PRODUCT_PAGE_SKIP = "Read from a product page's benefits, not a fee schedule";

/** A verified row as the publish step reads it, for one line of a stored document. */
function verifiedRow(input: { canonical_fee_key: string; fee_name: string; amount: string; source_document_id: number }, extra: Partial<VerifiedFeeRow> = {}): VerifiedFeeRow {
  return {
    fee_verified_id: 1,
    fee_raw_id: 1,
    institution_id: 1,
    source_url: "https://bank.example/fees",
    document_r2_key: null,
    extraction_confidence: 0.95,
    canonical_fee_key: input.canonical_fee_key,
    variant_type: null,
    outlier_flags: ["agentic_darwin_verified"],
    verified_by_agent_event_id: "00000000-0000-4000-8000-000000000001",
    fee_name: input.fee_name,
    amount: input.amount,
    frequency: null,
    raw_agent_event_id: null,
    source_document_id: input.source_document_id,
    fee_audience: "unknown",
    ...extra,
  };
}

/** What the publish step decides for `row` beside the live `prior` at the same price on the same page. */
function samePriceDecision(item: SamePriceCase): string {
  const row = verifiedRow({ ...item, fee_name: item.row.fee_name });
  const prior: PriorPublishedFeeRow = {
    fee_published_id: item.prior.fee_published_id,
    fee_name: item.prior.fee_name,
    amount: item.amount,
    published_at: "2026-10-01T00:00:00Z",
    source_document_id: item.source_document_id,
  };
  const apart = sameValueLinesApart(row, [prior], item.text);
  return decidePriorFee(row, [prior], (candidate) => apart.has(candidate)).kind;
}

function guardVerdict(item: CategoryCase): string {
  const verdict = checkFeeCategory(item.canonical_fee_key, item.fee_name, {
    amount: item.amount,
    conditions: `Knox deterministic extraction. text_hash=${item.text_hash}; excerpt="${item.excerpt}"`,
    document_nsf_amount: item.document_nsf_amount ?? null,
  });
  return verdict.ok ? "ok" : verdict.code;
}

/** A $0 free read on this document, as Knox's free-fee reader files it. */
function freeRead(item: DocumentCase): VerifiedFeeRow {
  return verifiedRow(
    { ...item, amount: "0.00" },
    { document_url: item.document_url, source_url: item.document_url, free_read: true, outlier_flags: ["agentic_darwin_verified", "zero_fee"] },
  );
}

const keys = <T extends { case_key: string }>(cases: T[]): Array<[string, T]> => cases.map((item) => [item.case_key, item]);

describe(`hard-document gate (category guard v${CATEGORY_GUARD_VERSION})`, () => {
  it("cites a stored document for every case, once", () => {
    const all = [...hard.same_price, ...hard.category, ...hard.documents, ...hard.near_name.cases, ...hard.known_misses.same_price, ...hard.known_misses.category];
    expect(new Set(all.map((item) => item.case_key)).size).toBe(all.length);
    for (const item of all) expect(Number.isInteger(item.source_document_id)).toBe(true);
    for (const item of [...hard.same_price, ...hard.category]) expect(item.text_hash).toMatch(/^[0-9a-f]{64}$/);
    // 52 once excess withdrawals and returned mail leave account research (#1398).
    expect(TAXONOMY_COUNT).toBe(RESEARCH_SPLIT_LIVE ? 52 : 50);
  });

  it("covers each of the five categories with the most wrong-after-publish takedowns", () => {
    expect(hard.measured.top_categories).toHaveLength(5);
    for (const { canonical_fee_key: key } of hard.measured.top_categories) {
      const guarded = hard.category.filter((item) => item.canonical_fee_key === key);
      const other = [...hard.same_price, ...hard.documents].filter((item) => item.canonical_fee_key === key);
      expect(guarded.some((item) => item.expected === "ok"), `${key}: a live fee the guard keeps`).toBe(true);
      expect(guarded.length + other.length, `${key}: cases`).toBeGreaterThanOrEqual(5);
    }
  });

  describe("two fees at one price on one page stay two fees", () => {
    const cases = hard.same_price.filter((item) => item.family === "distinct_same_dollar");
    it("has cases", () => expect(cases.length).toBeGreaterThanOrEqual(10));
    it.each(keys(cases))("%s", (_key, item) => {
      expect(samePriceDecision(item)).not.toBe("identical");
    });
  });

  describe("two reads of one printed line collapse into one fee", () => {
    const cases = hard.same_price.filter((item) => item.family === "true_duplicate");
    it("has cases", () => expect(cases.length).toBeGreaterThanOrEqual(4));
    it.each(keys(cases))("%s", (_key, item) => {
      expect(samePriceDecision(item)).toBe("identical");
    });
  });

  describe("the page check finds two printed lines for two fees and one for two reads", () => {
    it.each(keys(hard.same_price))("%s", (_key, item) => {
      const apart = linesApartOnPage(item.text, item.row.fee_name, item.prior.fee_name, item.amount);
      expect(apart).toBe(item.family === "distinct_same_dollar");
    });
  });

  describe("the duplicate collapse closes near-name reads of one printed line and keeps two printed lines", () => {
    it.each(keys(hard.near_name.cases))("%s", (_key, item) => {
      const text = item.text ?? hard.same_price.find((other) => other.case_key === item.text_of)?.text;
      expect(text, "the case's text").toBeTruthy();
      const rows = item.rows.map((row) => ({ ...row, institution_id: 1, source_document_id: item.source_document_id, canonical_fee_key: item.canonical_fee_key, variant_type: null, amount: item.amount }));
      const { collapses } = nearNameRepeats(rows, new Map([[String(item.source_document_id), text ?? ""]]));
      expect(collapses.map((row) => row.feePublishedId).sort()).toEqual([...item.closed].sort());
      for (const row of collapses) expect(row.keptFeePublishedId).toBe(item.kept);
    });
  });

  describe("a product page's benefit list is held before release; a fee schedule is not", () => {
    it.each(keys(hard.documents))("%s", (_key, item) => {
      const product = item.family === "product_page";
      expect(isProductPage(item.document_url)).toBe(product);
      const reason = publishSkipReason(freeRead(item), 0.85);
      if (product) expect(reason).toBe(PRODUCT_PAGE_SKIP);
      else expect(reason).not.toBe(PRODUCT_PAGE_SKIP);
    });
  });

  describe("the category guard keeps real fees and refuses the wrong ones", () => {
    it.each(keys(hard.category))("%s", (_key, item) => {
      expect(guardVerdict(item)).toBe(item.expected);
    });
  });
});

describe("hard documents the rules still get wrong (expected failures)", () => {
  it.fails.each(keys(hard.known_misses.same_price))("%s stays two fees", (_key, item) => {
    expect(samePriceDecision(item)).not.toBe("identical");
  });
  it.fails.each(keys(hard.known_misses.category))("%s is refused", (_key, item) => {
    expect(guardVerdict(item)).not.toBe("ok");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { refileCategory } from "@/lib/fee-category-guard";

const liveSwitch = vi.hoisted(() => ({ on: false }));
vi.mock("./category-change", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./category-change")>();
  return {
    ...actual,
    get DARWIN_CATEGORY_CHANGE_REJUDGE_LIVE() {
      return liveSwitch.on;
    },
  };
});

import {
  categoryChangeCandidates,
  categoryChangedSinceDecision,
  DARWIN_CATEGORY_CHANGE_REJUDGE_LIVE,
  hasCategoryChangeMarker,
  summarizeCategoryChange,
  type CategoryChangeRow,
} from "./category-change";
import { canonicalHintFrom, DARWIN_VERIFY_STRATEGY, runDarwinVerify } from "./verify";

/**
 * Real rows and source lines from production (read-only, 2026-10-14).
 * Document 7699 (institution 7114): the schedule Knox re-read; raw 126752 was taken over by the
 * re-read under `wire_intl_outgoing` but kept its old `canonical_hint:overdraft` first, and Darwin
 * rejected it as `category_mismatch` on every run from Oct 5 to Oct 14 (#1093, #1291).
 */
const DOC_7699_LINES = [
  "Copy of Corporate Check | $10.00",
  "Corporate Check Stop Payment | $25.00",
  "Wire Transfer - Domestic | $35.00",
  "Wire Transfer - International | $45.00",
  "Overdraft Transfer from Shares | $3.00 per transfer",
  "Sustained Overdraft Fee | $5.00 per day after 10th business day",
];
/** Document 13279, Oregonians CU: lines #1291's re-file pass reads under a new category. */
const DOC_13279_LINES = [
  "Bad Address/Returned Mail $10 Business Money Market Service Charge $10/month",
  "First three per month are free. Card Replacement $10",
  "Incoming Wires $10",
];

const WIRE_CONDITIONS =
  "Knox deterministic extraction from Rosetta artifact #3981. canonical_hint=wire_intl_outgoing; text_hash=51382a267bfe9ee690de9016ed1f3a8f504ff2d690aedcc46dada9249870575e; calibrated_confidence=0.98; excerpt=\"Wire Transfer - International | $45.00\"";

/** Raw 126752 as it is on production today: the stale flag first. */
const wireStale: CategoryChangeRow = {
  fee_raw_id: 126752,
  institution_id: 7114,
  fee_name: "Wire Transfer - International",
  amount: "45.00",
  outlier_flags: ["canonical_hint:overdraft", "needs_darwin_verification", "canonical_hint:wire_intl_outgoing", "knox_reread_took_over"],
  conditions: WIRE_CONDITIONS,
  attempts: [
    { canonical_fee_key: "overdraft", reason_code: "category_mismatch", decided_at: "2026-10-14T03:00:00Z" },
    { canonical_fee_key: "overdraft", reason_code: "category_mismatch", decided_at: "2026-10-05T03:00:00Z" },
  ],
};
/** The same row after #1291 drops the stale flag. */
const wireRepaired: CategoryChangeRow = {
  ...wireStale,
  outlier_flags: ["needs_darwin_verification", "canonical_hint:wire_intl_outgoing", "knox_reread_took_over", "knox_stale_hint_repaired"],
};

/** Oregonians CU "Incoming Wires" $10, re-filed by #1291 from `nsf`. */
const incomingWires: CategoryChangeRow = {
  fee_raw_id: 9_000_001,
  institution_id: 4321,
  fee_name: "Incoming Wires",
  amount: "10.00",
  outlier_flags: ["needs_darwin_verification", "canonical_hint:wire_domestic_incoming", "knox_promoted_from_superseded", "knox_refiled_from:nsf"],
  conditions: "canonical_hint=wire_domestic_incoming; excerpt=\"Incoming Wires $10\"",
  attempts: [{ canonical_fee_key: "nsf", reason_code: "category_mismatch" }],
};

describe("Darwin judges a row again when Knox changes its category (#1295)", () => {
  it("ships switched off", () => {
    liveSwitch.on = false;
    expect(DARWIN_CATEGORY_CHANGE_REJUDGE_LIVE).toBe(false);
  });

  it("needs a Knox re-read marker", () => {
    expect(hasCategoryChangeMarker(wireStale.outlier_flags)).toBe(true);
    expect(hasCategoryChangeMarker(incomingWires.outlier_flags)).toBe(true);
    expect(hasCategoryChangeMarker(["needs_darwin_verification", "canonical_hint:overdraft"])).toBe(false);
    // An unmarked row whose category differs from the decision is Darwin's own re-file, not Knox's.
    const unmarked = { ...incomingWires, outlier_flags: ["needs_darwin_verification", "canonical_hint:wire_domestic_incoming"] };
    expect(categoryChangeCandidates([unmarked], canonicalHintFrom)).toEqual([]);
  });

  it("leaves 126752 alone while its stale flag is first, and judges it again once Knox repairs it", () => {
    expect(categoryChangeCandidates([wireStale], canonicalHintFrom)).toEqual([]);
    const [candidate] = categoryChangeCandidates([wireRepaired], canonicalHintFrom);
    expect(candidate).toMatchObject({
      feeRawId: 126752,
      category: "wire_intl_outgoing",
      judgedAs: "overdraft",
      reasons: ["category_mismatch", "category_mismatch"],
    });
  });

  it("judges a re-filed row under its new category and records the old one", () => {
    const [candidate] = categoryChangeCandidates([incomingWires], canonicalHintFrom);
    expect(candidate).toMatchObject({ category: "wire_domestic_incoming", judgedAs: "nsf", refiledFrom: "nsf" });
  });

  it("never judges a row again for Darwin's own re-file of Knox's category", () => {
    // Production row, Oct 14: Knox files it collection_item, Darwin's re-file judged it as check_cashing.
    const name = "Collection Items (plus any bank fees)";
    const judged = refileCategory("collection_item", name);
    expect(categoryChangedSinceDecision("collection_item", name, [{ canonical_fee_key: judged, reason_code: "peer_outlier" }])).toBe(false);
  });

  it("judges each category once: a decision under today's category ends it", () => {
    expect(categoryChangedSinceDecision("wire_intl_outgoing", "Wire Transfer - International", [
      { canonical_fee_key: "wire_intl_outgoing", knox_category: "wire_intl_outgoing", reason_code: null },
      { canonical_fee_key: "overdraft", reason_code: "category_mismatch" },
    ])).toBe(false);
    // Knox's own category, recorded from #1295 on, counts even when Darwin judged it re-filed.
    expect(categoryChangedSinceDecision("wire_intl_outgoing", "Wire Transfer - International", [
      { canonical_fee_key: "something_else", knox_category: "wire_intl_outgoing", reason_code: "peer_outlier" },
    ])).toBe(false);
    expect(categoryChangedSinceDecision("wire_intl_outgoing", "Wire Transfer - International", [])).toBe(false);
  });

  it("counts candidates by earlier reason for the ledger", () => {
    const candidates = categoryChangeCandidates([wireStale, wireRepaired, incomingWires], canonicalHintFrom);
    const summary = summarizeCategoryChange(candidates, 3, 0, false);
    expect(summary).toMatchObject({
      live: false,
      candidates: 2,
      candidateInstitutions: 2,
      scanned: 3,
      truncated: false,
      selected: 0,
      reasonCounts: { category_mismatch: 2 },
    });
    expect(summary.sample[0]).toMatchObject({ fee_raw_id: 126752, category_now: "wire_intl_outgoing", judged_as: "overdraft" });
  });
});

describe("runDarwinVerify with the category-change pass", () => {
  type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

  const wireRaw = {
    fee_raw_id: 126752,
    institution_id: 7114,
    source_url: "https://cu.example/fees",
    document_r2_key: null,
    extraction_confidence: "0.98",
    fee_name: "Wire Transfer - International",
    amount: "45.00",
    frequency: null,
    fee_audience: "unknown",
    source_document_id: 7699,
    outlier_flags: wireRepaired.outlier_flags,
    conditions: WIRE_CONDITIONS,
    state_code: "OR",
  };
  /** A re-filed line the stored text does not state: the shared source check still decides. */
  const notStated = {
    ...wireRaw,
    fee_raw_id: 126799,
    fee_name: "Incoming Wires",
    amount: "12.00",
    outlier_flags: ["needs_darwin_verification", "canonical_hint:wire_domestic_incoming", "knox_refiled_from:nsf"],
    conditions: "canonical_hint=wire_domestic_incoming; excerpt=\"Incoming Wires $12\"",
  };

  function verifyDb(): DbMock {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = Array.isArray(strings) ? strings.join(" ") : String(strings);
      if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
      if (text.includes("superseded_by_id")) return Promise.resolve([{ ready: true }]);
      if (text.includes("FROM agent_source_texts")) {
        return Promise.resolve([
          { source_document_id: 7699, normalized_text: [...DOC_7699_LINES, ...DOC_13279_LINES].join("\n") },
        ]);
      }
      if (text.includes("INSERT INTO verified_fee_observations")) return Promise.resolve([{ fee_verified_id: 5100 }]);
      return Promise.resolve([]);
    }) as DbMock;
    db.unsafe = vi.fn((query: string, params?: unknown[]) => {
      if (query.includes("'knox_category'")) {
        return Promise.resolve([
          { ...wireRepaired, attempts: wireRepaired.attempts },
          { ...notStated, attempts: [{ canonical_fee_key: "nsf", reason_code: "category_mismatch" }] },
          { ...wireStale, fee_raw_id: 126700, attempts: wireStale.attempts },
        ]);
      }
      if (query.includes("FROM raw_fee_observations")) {
        const ids = (params ?? []).find((param) => Array.isArray(param)) as number[] | undefined;
        if (!ids) return Promise.resolve([]);
        return Promise.resolve([wireRaw, notStated].filter((row) => ids.includes(row.fee_raw_id)));
      }
      return Promise.resolve([]);
    });
    return db;
  }

  function verifyAttempts(db: DbMock): unknown[][] {
    return db.mock.calls
      .filter((call) => {
        const text = (call[0] as string[]).join(" ");
        return text.includes("INSERT INTO pipeline_attempts") && call.includes(DARWIN_VERIFY_STRATEGY.strategy);
      })
      .map((call) => call.slice(1));
  }

  beforeEach(() => {
    liveSwitch.on = false;
  });

  it("while off, counts and samples the candidates and judges nothing", async () => {
    const db = verifyDb();
    const result = await runDarwinVerify({ runId: 9001, db: db as never });

    expect(result.categoryChange).toMatchObject({ live: false, candidates: 2, scanned: 3, selected: 0 });
    expect(result.categoryChange?.sample.map((row) => row.fee_raw_id)).toEqual([126752, 126799]);
    expect(result.processedRawFees).toBe(0);
    expect(db.mock.calls.some((call) => (call[0] as string[]).join(" ").includes("INSERT INTO verified_fee_observations"))).toBe(false);
  });

  it("on, judges them under today's category with the same free checks, the source check among them", async () => {
    liveSwitch.on = true;
    const db = verifyDb();
    const result = await runDarwinVerify({ runId: 9002, db: db as never });

    expect(result.categoryChange).toMatchObject({ live: true, candidates: 2, selected: 2 });
    const byId = new Map(result.results.map((row) => [row.feeRawId, row]));
    // "Wire Transfer - International | $45.00" is on the schedule: verified as an international wire.
    expect(byId.get(126752)).toMatchObject({ status: "verified", canonicalFeeKey: "wire_intl_outgoing" });
    // A $12 the schedule never states stays out, whatever its category.
    expect(byId.get(126799)).toMatchObject({ status: "skipped", reasonCode: "not_in_source" });

    const forced = db.unsafe.mock.calls.find((call) => Array.isArray((call[1] as unknown[])?.[1]));
    expect(String(forced?.[0])).toContain("fr.fee_raw_id = ANY($2::bigint[])");
    expect(String(forced?.[0])).not.toContain("FROM pipeline_attempts pa");

    // Each decision records Knox's category, so the row is judged once per category.
    const attempts = verifyAttempts(db);
    expect(attempts).toHaveLength(2);
    const detail = JSON.parse(String(attempts[0].find((value) => typeof value === "string" && value.startsWith("{"))));
    expect(detail).toMatchObject({ fee_raw_id: 126752, knox_category: "wire_intl_outgoing", canonical_fee_key: "wire_intl_outgoing" });
  });

  it("a dry run reads the count and judges nothing, even with the switch on", async () => {
    liveSwitch.on = true;
    const db = verifyDb();
    const result = await runDarwinVerify({ runId: 9003, dryRun: true, db: db as never });

    expect(result.categoryChange).toMatchObject({ live: false, candidates: 2, selected: 0 });
    expect(result.processedRawFees).toBe(0);
  });
});

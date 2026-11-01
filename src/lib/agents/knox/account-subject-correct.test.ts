// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const learning = vi.hoisted(() => ({
  feedback: [] as unknown[],
  attempts: [] as unknown[],
  invalidated: 0,
}));
vi.mock("@/lib/agents/learning/feedback", () => ({
  feedbackSchemaReady: vi.fn(async () => true),
  recordFeedback: vi.fn(async (_db: unknown, rows: unknown[]) => { learning.feedback.push(...rows); return rows.length; }),
}));
vi.mock("@/lib/agents/learning/attempts", () => ({
  recordAttempt: vi.fn(async (_db: unknown, attempt: unknown) => { learning.attempts.push(attempt); }),
}));
vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn(() => { learning.invalidated += 1; }) }));

import type { sql } from "@/lib/data-store/connection";
import { MT_PREFERRED_MONEY_MARKET_TEXT, MT_WAIVER_EXCERPT } from "./__fixtures__/mt-preferred-money-market-21879";
import {
  ACCOUNT_SUBJECT_CORRECT_KIND,
  ACCOUNT_SUBJECT_CORRECT_STRATEGY,
  accountSubjectCorrectFingerprint,
  accountSubjectCorrectLive,
  correctAccountSubjects,
  noteExcerpt,
  planAccountSubjectCorrections,
  type AccountSubjectRow,
} from "./account-subject-correct";

const MT = "Manufacturers and Traders Trust Company";
const NOTE = `Knox deterministic extraction from Rosetta artifact #21879. canonical_hint=monthly_maintenance; text_hash=aab1; calibrated_confidence=0.88; excerpt="${MT_WAIVER_EXCERPT}"`;

/** M&T's live row of #1912 (institution 21, document 24707, text 21879), plus rows the step must leave. */
const mtRows = (values: Partial<AccountSubjectRow> = {}): AccountSubjectRow[] => [
  { fee_raw_id: 491668, fee_published_id: 109815, institution_id: 21, source_document_id: 24707, fee_name: "Monthly maintenance charge", amount: "20.00", canonical_fee_key: "monthly_maintenance", product_name: null, extraction_note: NOTE, ...values },
  // Not the sentence's price.
  { fee_raw_id: 491669, fee_published_id: 109816, institution_id: 21, source_document_id: 24707, fee_name: "Monthly maintenance charge", amount: "25.00", canonical_fee_key: "monthly_maintenance", product_name: null, extraction_note: NOTE.replace("$20", "$25"), ...values },
  // Not an account-priced category.
  { fee_raw_id: 491670, fee_published_id: 109817, institution_id: 21, source_document_id: 24707, fee_name: "Per-check fee", amount: "20.00", canonical_fee_key: "excess_withdrawal", product_name: null, extraction_note: NOTE, ...values },
];

const sources = (text = MT_PREFERRED_MONEY_MARKET_TEXT) => new Map([[24707, { textId: 21879, text, institutionName: MT }]]);

describe("planAccountSubjectCorrections", () => {
  it("gives M&T's live $20 money market charge its account, and nothing else", () => {
    const planned = planAccountSubjectCorrections(mtRows(), sources());
    expect(planned.map((fix) => [fix.feeRawId, fix.feePublishedId, fix.old, fix.new, fix.textId])).toEqual([
      [491668, 109815, null, "M&T Preferred Money Market", 21879],
    ]);
    expect(planned[0].excerpt).toBe(MT_WAIVER_EXCERPT);
  });

  it("reads a note not yet moved out of conditions", () => {
    const rows = mtRows({ extraction_note: null, conditions: NOTE }).slice(0, 1);
    expect(planAccountSubjectCorrections(rows, sources())).toHaveLength(1);
  });

  it("never changes a labelled row, a row without its note, or a row without its text", () => {
    expect(planAccountSubjectCorrections(mtRows({ product_name: "Advantage Checking" }), sources())).toEqual([]);
    expect(planAccountSubjectCorrections(mtRows({ extraction_note: null }), sources())).toEqual([]);
    expect(planAccountSubjectCorrections(mtRows(), new Map())).toEqual([]);
  });

  it("leaves a fee whose read today prefers another account to the lineup correction", () => {
    const text = MT_PREFERRED_MONEY_MARKET_TEXT.replace("Understanding the monthly maintenance charge", "Advantage Checking");
    expect(planAccountSubjectCorrections(mtRows(), sources(text))).toEqual([]);
  });

  it("reads the stored excerpt and fingerprints by strategy version and text", () => {
    expect(noteExcerpt(NOTE)).toBe(MT_WAIVER_EXCERPT);
    expect(noteExcerpt("no note")).toBeNull();
    expect(ACCOUNT_SUBJECT_CORRECT_STRATEGY).toEqual({ strategy: "knox.account_subject_correct", version: 1 });
    expect(accountSubjectCorrectFingerprint(21879)).toBe("v1:21879");
  });
});

describe("accountSubjectCorrectLive", () => {
  it("is off unless the switch says 1 or true", () => {
    expect(accountSubjectCorrectLive({} as NodeJS.ProcessEnv)).toBe(false);
    expect(accountSubjectCorrectLive({ KNOX_ACCOUNT_SUBJECT_CORRECT_LIVE: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(accountSubjectCorrectLive({ KNOX_ACCOUNT_SUBJECT_CORRECT_LIVE: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(accountSubjectCorrectLive({ KNOX_ACCOUNT_SUBJECT_CORRECT_LIVE: " \"True\" " } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});

/** A stand-in for the run's transaction: the two selects answer with the prod shape; writes are kept. */
function fakeDb(raw: Map<number, { product_name: string | null }>, onRowsSelected?: () => void) {
  const writes: { query: string; values: unknown[] }[] = [];
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    if (query.includes("JOIN LATERAL")) {
      return [{ source_document_id: 24707, institution_id: 21, institution_name: MT, text_id: 21879, normalized_text: MT_PREFERRED_MONEY_MARKET_TEXT }];
    }
    if (query.trimStart().startsWith("SELECT fr.fee_raw_id")) {
      const rows = mtRows().filter((row) => raw.get(Number(row.fee_raw_id))?.product_name == null);
      onRowsSelected?.();
      return rows;
    }
    writes.push({ query, values });
    if (query.includes("UPDATE raw_fee_observations")) {
      const [product, id] = [values[0], values[1]];
      const row = raw.get(Number(id));
      if (!row || row.product_name != null) return [];
      row.product_name = String(product);
      return [{ fee_raw_id: id }];
    }
    return [];
  };
  return { db: tag as unknown as typeof sql, writes };
}

describe("correctAccountSubjects", () => {
  let raw: Map<number, { product_name: string | null }>;
  beforeEach(() => {
    learning.feedback.length = 0;
    learning.attempts.length = 0;
    learning.invalidated = 0;
    raw = new Map([491668, 491669, 491670].map((id) => [id, { product_name: null }]));
  });

  it("never screens in an unscoped step", async () => {
    const { db, writes } = fakeDb(raw);
    const result = await correctAccountSubjects(db, { runId: 1, dryRun: false, live: true });
    expect(result).toMatchObject({ documentsChecked: 0, rowsChecked: 0, corrected: [] });
    expect(writes).toEqual([]);
  });

  it("with the switch off only counts and lists, and writes nothing", async () => {
    const { db, writes } = fakeDb(raw);
    const result = await correctAccountSubjects(db, { institutionId: 21, runId: 1, dryRun: false, live: false });
    expect(result).toMatchObject({ live: false, dryRun: true, documentsChecked: 1, rowsChecked: 3, error: null });
    expect(result.corrected.map((fix) => fix.feeRawId)).toEqual([491668]);
    expect(writes).toEqual([]);
    expect(learning.feedback).toEqual([]);
    expect(learning.attempts).toEqual([]);
    expect([...raw.values()].every((row) => row.product_name === null)).toBe(true);
  });

  it("a dry-run run writes nothing even with the switch on", async () => {
    const { db, writes } = fakeDb(raw);
    const result = await correctAccountSubjects(db, { stateCode: "ny", runId: 1, dryRun: true, live: true });
    expect(result).toMatchObject({ live: true, dryRun: true });
    expect(result.corrected).toHaveLength(1);
    expect(writes).toEqual([]);
  });

  it("applied, fills only the NULL account, keeps old and new values, and records the attempt and event", async () => {
    const { db, writes } = fakeDb(raw);
    const result = await correctAccountSubjects(db, { institutionId: 21, runId: 7, stepId: 70, dryRun: false, live: true });
    expect(result).toMatchObject({ live: true, dryRun: false, error: null });
    expect(result.corrected.map((fix) => fix.feeRawId)).toEqual([491668]);
    expect(raw.get(491668)?.product_name).toBe("M&T Preferred Money Market");
    expect(raw.get(491669)?.product_name).toBeNull();
    expect(raw.get(491670)?.product_name).toBeNull();
    const updates = writes.filter((write) => write.query.includes("UPDATE raw_fee_observations"));
    expect(updates).toHaveLength(1);
    expect(updates[0].query).toContain("product_name IS NULL");
    expect(updates[0].query).toContain("fee_name = ?");
    expect(learning.feedback).toMatchObject([
      { kind: ACCOUNT_SUBJECT_CORRECT_KIND, feeRawId: 491668, feePublishedId: 109815, weight: 0, evidence: { field: "product_name", old: null, new: "M&T Preferred Money Market", text_id: 21879 } },
    ]);
    expect(learning.attempts).toMatchObject([
      { sourceDocumentId: 24707, strategy: "knox.account_subject_correct", version: 1, fingerprint: "v1:21879", outcome: "ok", yieldCount: 1, costMicrousd: 0, runId: 7, stepId: 70 },
    ]);
    expect(writes.some((write) => write.query.includes("INSERT INTO agent_run_events"))).toBe(true);
    expect(learning.invalidated).toBe(1);
  });

  it("applied, a row labelled between the read and the write keeps its label", async () => {
    const { db } = fakeDb(raw, () => { raw.get(491668)!.product_name = "Advantage Checking"; });
    const result = await correctAccountSubjects(db, { institutionId: 21, runId: 8, dryRun: false, live: true });
    expect(result.corrected).toEqual([]);
    expect(raw.get(491668)?.product_name).toBe("Advantage Checking");
    expect(learning.feedback).toEqual([]);
    expect(learning.attempts).toMatchObject([{ outcome: "unchanged", yieldCount: 0 }]);
    expect(learning.invalidated).toBe(0);
  });
});

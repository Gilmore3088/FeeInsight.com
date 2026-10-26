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
import { statedInOwnSource } from "@/lib/agents/darwin/verify";
import { ANCILLARY_PRODUCT_FLAG } from "./ancillary-product";
import { ancillaryAccountText, ancillaryOfficialText } from "./ancillary-product-fixtures";
import {
  ANCILLARY_OWNER_CORRECT_KIND,
  ANCILLARY_OWNER_CORRECT_STRATEGY,
  ancillaryOwnerCorrectFingerprint,
  ancillaryOwnerCorrectLive,
  correctAncillaryOwners,
  planAncillaryOwnerCorrections,
  type AncillaryOwnerRow,
} from "./ancillary-owner-correct";

const US_BANK = "U.S. Bank National Association";

/** The prod rows of #1911 (U.S. Bank, institution 5, document 33344, text 31406), as stored. */
const usBankRows = (values: Partial<AncillaryOwnerRow> = {}): AncillaryOwnerRow[] => [
  { fee_raw_id: 678084, fee_published_id: 142603, institution_id: 5, source_document_id: 33344, fee_name: "Personal money order", amount: "1.65", canonical_fee_key: "money_order", product_name: null, ...values },
  { fee_raw_id: 678085, fee_published_id: 142604, institution_id: 5, source_document_id: 33344, fee_name: "Non-U.S. Bank ATM transaction fee", amount: "2.50", canonical_fee_key: "atm_non_network", product_name: null, ...values },
  // Account-priced: the monthly fee is the account's own price, never an ancillary row.
  { fee_raw_id: 678083, fee_published_id: 142602, institution_id: 5, source_document_id: 33344, fee_name: "Monthly Maintenance Fee", amount: "4.95", canonical_fee_key: "monthly_maintenance", product_name: null, ...values },
];

const sources = (text: string) => new Map([[33344, { textId: 31406, text, institutionName: US_BANK }]]);

describe("planAncillaryOwnerCorrections", () => {
  it("gives U.S. Bank's two live Safe Debit exceptions their product, and nothing else", async () => {
    const safe = await ancillaryOfficialText("safe");
    const planned = planAncillaryOwnerCorrections(usBankRows(), sources(safe));
    expect(planned.map((fix) => [fix.feeRawId, fix.feePublishedId, fix.old, fix.new, fix.textId])).toEqual([
      [678084, 142603, null, "Safe Debit Account", 31406],
      [678085, 142604, null, "Safe Debit Account", 31406],
    ]);
    expect(planned[0].ownLine).toContain("Personal money order - $1.65 each");
    expect(planned[1].ownLine).toContain("$2.50");
  });

  it("leaves each recovered fee traced by Darwin's narrowed own-block check", async () => {
    const safe = await ancillaryOfficialText("safe");
    for (const fix of planAncillaryOwnerCorrections(usBankRows(), sources(safe))) {
      const row = { fee_name: fix.feeName, amount: fix.amount, source_document_id: 33344, amount_kind: "flat", rate_percent: null,
        product_name: fix.new, outlier_flags: [ANCILLARY_PRODUCT_FLAG] };
      expect(statedInOwnSource(row as never, new Map([[33344, safe]]), fix.canonicalFeeKey), fix.feeName).toBe(true);
    }
  });

  it("leaves a fee on the general multi-account schedule alone", async () => {
    const general = await ancillaryOfficialText("general");
    const rows = usBankRows({ source_document_id: 33344 }).map((row) => ({ ...row, amount: row.fee_raw_id === 678084 ? "5.00" : "3.00" }));
    expect(planAncillaryOwnerCorrections(rows, sources(general))).toEqual([]);
  });

  it("never changes a row that already holds a product", async () => {
    const safe = await ancillaryOfficialText("safe");
    expect(planAncillaryOwnerCorrections(usBankRows({ product_name: "Standard Checking" }), sources(safe))).toEqual([]);
  });

  it("needs the fee's own price in the product's block, and the document's text", () => {
    const text = ancillaryAccountText();
    const row: AncillaryOwnerRow = { fee_raw_id: 1, fee_published_id: 2, institution_id: 3, source_document_id: 33344, fee_name: "Personal money order", amount: "30", canonical_fee_key: "money_order", product_name: null };
    expect(planAncillaryOwnerCorrections([row], sources(text))).toEqual([]);
    expect(planAncillaryOwnerCorrections([{ ...row, amount: "5" }], new Map())).toEqual([]);
    expect(planAncillaryOwnerCorrections([{ ...row, amount: "5" }, { ...row, amount: "5", fee_published_id: 9 }], sources(text)))
      .toMatchObject([{ feeRawId: 1, new: "Everyday Debit Account" }]);
  });

  it("fingerprints by strategy version and text", () => {
    expect(ANCILLARY_OWNER_CORRECT_STRATEGY).toEqual({ strategy: "knox.ancillary_owner_correct", version: 1 });
    expect(ancillaryOwnerCorrectFingerprint(31406)).toBe("v1:31406");
  });
});

describe("ancillaryOwnerCorrectLive", () => {
  it("is off unless the switch says 1 or true", () => {
    expect(ancillaryOwnerCorrectLive({} as NodeJS.ProcessEnv)).toBe(false);
    expect(ancillaryOwnerCorrectLive({ KNOX_ANCILLARY_OWNER_CORRECT_LIVE: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(ancillaryOwnerCorrectLive({ KNOX_ANCILLARY_OWNER_CORRECT_LIVE: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(ancillaryOwnerCorrectLive({ KNOX_ANCILLARY_OWNER_CORRECT_LIVE: " \"True\" " } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});

/** A stand-in for the run's transaction: the two selects answer with the prod shape; writes are kept. */
function fakeDb(text: string, raw: Map<number, { product_name: string | null; outlier_flags: string[] }>) {
  const writes: { query: string; values: unknown[] }[] = [];
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    if (query.includes("JOIN LATERAL")) {
      return [{ source_document_id: 33344, institution_id: 5, institution_name: US_BANK, text_id: 31406, normalized_text: text }];
    }
    if (query.trimStart().startsWith("SELECT fr.fee_raw_id")) {
      return usBankRows().filter((row) => raw.get(Number(row.fee_raw_id))?.product_name == null);
    }
    writes.push({ query, values });
    if (query.includes("UPDATE raw_fee_observations")) {
      const [product, , id] = [values[0], values[1], values[3]];
      const row = raw.get(Number(id));
      if (!row || row.product_name != null) return [];
      row.product_name = String(product);
      if (!row.outlier_flags.includes(ANCILLARY_PRODUCT_FLAG)) row.outlier_flags.push(ANCILLARY_PRODUCT_FLAG);
      return [{ fee_raw_id: id }];
    }
    return [];
  };
  return { db: tag as unknown as typeof sql, writes };
}

describe("correctAncillaryOwners", () => {
  let raw: Map<number, { product_name: string | null; outlier_flags: string[] }>;
  beforeEach(() => {
    learning.feedback.length = 0;
    learning.attempts.length = 0;
    learning.invalidated = 0;
    raw = new Map([678083, 678084, 678085].map((id) => [id, { product_name: null, outlier_flags: ["needs_darwin_verification"] }]));
  });

  it("with the switch off only counts and lists, and writes nothing", async () => {
    const { db, writes } = fakeDb(await ancillaryOfficialText("safe"), raw);
    const result = await correctAncillaryOwners(db, { runId: 1, dryRun: false, live: false });
    expect(result).toMatchObject({ live: false, dryRun: true, documentsChecked: 1, rowsChecked: 3, error: null });
    expect(result.corrected.map((fix) => fix.feeRawId)).toEqual([678084, 678085]);
    expect(writes).toEqual([]);
    expect(learning.feedback).toEqual([]);
    expect(learning.attempts).toEqual([]);
    expect([...raw.values()].every((row) => row.product_name === null)).toBe(true);
  });

  it("a dry-run run writes nothing even with the switch on", async () => {
    const { db, writes } = fakeDb(await ancillaryOfficialText("safe"), raw);
    const result = await correctAncillaryOwners(db, { runId: 1, dryRun: true, live: true });
    expect(result).toMatchObject({ live: true, dryRun: true });
    expect(result.corrected).toHaveLength(2);
    expect(writes).toEqual([]);
  });

  it("applied, fills only the NULL products, keeps old and new values, and records the attempt", async () => {
    const { db, writes } = fakeDb(await ancillaryOfficialText("safe"), raw);
    const result = await correctAncillaryOwners(db, { runId: 7, stepId: 70, dryRun: false, live: true });
    expect(result).toMatchObject({ live: true, dryRun: false, error: null });
    expect(result.corrected.map((fix) => fix.feeRawId)).toEqual([678084, 678085]);
    expect(raw.get(678084)).toEqual({ product_name: "Safe Debit Account", outlier_flags: ["needs_darwin_verification", ANCILLARY_PRODUCT_FLAG] });
    expect(raw.get(678085)?.product_name).toBe("Safe Debit Account");
    expect(raw.get(678083)?.product_name).toBeNull();
    const updates = writes.filter((write) => write.query.includes("UPDATE raw_fee_observations"));
    expect(updates).toHaveLength(2);
    expect(updates.every((write) => write.query.includes("product_name IS NULL"))).toBe(true);
    expect(learning.feedback).toMatchObject([
      { kind: ANCILLARY_OWNER_CORRECT_KIND, feeRawId: 678084, feePublishedId: 142603, weight: 0, evidence: { field: "product_name", old: null, new: "Safe Debit Account", flag_added: ANCILLARY_PRODUCT_FLAG, text_id: 31406 } },
      { kind: ANCILLARY_OWNER_CORRECT_KIND, feeRawId: 678085, feePublishedId: 142604 },
    ]);
    expect(learning.attempts).toMatchObject([
      { sourceDocumentId: 33344, strategy: "knox.ancillary_owner_correct", version: 1, fingerprint: "v1:31406", outcome: "ok", yieldCount: 2, costMicrousd: 0, runId: 7, stepId: 70 },
    ]);
    expect(writes.some((write) => write.query.includes("INSERT INTO agent_run_events"))).toBe(true);
    expect(learning.invalidated).toBe(1);
  });

  it("applied, a row labelled between the read and the write keeps its label", async () => {
    const { db } = fakeDb(await ancillaryOfficialText("safe"), raw);
    const planned = await correctAncillaryOwners(db, { runId: 7, dryRun: false, live: false });
    expect(planned.corrected).toHaveLength(2);
    // Someone labels 678085 before the apply's UPDATE lands.
    const tagged = fakeDb(await ancillaryOfficialText("safe"), raw);
    const original = tagged.db;
    let selects = 0;
    const racing = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const result = await (original as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>)(strings, ...values);
      if (strings.join("?").trimStart().startsWith("SELECT fr.fee_raw_id") && ++selects === 1) raw.get(678085)!.product_name = "Standard Checking";
      return result;
    }) as unknown as typeof sql;
    const result = await correctAncillaryOwners(racing, { runId: 8, dryRun: false, live: true });
    expect(result.corrected.map((fix) => fix.feeRawId)).toEqual([678084]);
    expect(raw.get(678085)?.product_name).toBe("Standard Checking");
    expect(learning.feedback).toHaveLength(1);
    expect(learning.attempts).toMatchObject([{ outcome: "ok", yieldCount: 1 }]);
  });

  it("applied on a general schedule changes nothing and settles the document as unchanged", async () => {
    const { db, writes } = fakeDb(await ancillaryOfficialText("general"), raw);
    const result = await correctAncillaryOwners(db, { runId: 9, dryRun: false, live: true });
    expect(result.corrected).toEqual([]);
    expect(writes.filter((write) => write.query.includes("UPDATE"))).toEqual([]);
    expect(learning.feedback).toEqual([]);
    expect(learning.attempts).toMatchObject([{ outcome: "unchanged", yieldCount: 0, fingerprint: "v1:31406" }]);
    expect(learning.invalidated).toBe(0);
  });
});

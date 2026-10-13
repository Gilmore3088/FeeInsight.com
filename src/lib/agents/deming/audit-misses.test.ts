import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { AUDIT_LABEL, auditCaseKey, auditCases, auditFeedback, missOwner, recordAuditMisses } from "./audit-misses";
import { NAME_QUALITY_CHECK, type FreshAuditMiss, type FreshAuditResult } from "./fresh-audit";

const miss = (over: Partial<FreshAuditMiss>): FreshAuditMiss => ({
  feeId: 1,
  feePublishedId: 501,
  sourceDocumentId: 77,
  documentUrl: "https://other.example/fees.pdf",
  institutionId: 9,
  canonicalFeeKey: "overdraft",
  feeName: "Overdraft fee",
  amount: 30,
  check: "hamilton.unconfirmed_document_host",
  reason: "unconfirmed_document_host",
  severity: "critical",
  pending: false,
  ...over,
});

describe("Deming's audit misses (#1119)", () => {
  it("sends wrong documents to Magellan and everything read from the right one to Knox", () => {
    expect(missOwner("hamilton.other_bank_document")).toEqual({ agent: "magellan", stage: "discover" });
    expect(missOwner("hamilton.product_page")).toEqual({ agent: "magellan", stage: "discover" });
    expect(missOwner(NAME_QUALITY_CHECK)).toEqual({ agent: "knox", stage: "extract" });
    expect(missOwner("hamilton.source_check")).toEqual({ agent: "knox", stage: "extract" });
  });

  it("keeps each new miss as an unconfirmed fresh_audit case the replay never reads, and skips held ones", () => {
    const cases = auditCases([miss({}), miss({ feePublishedId: 502, pending: true })], "2026-10-13");
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ case_key: auditCaseKey(miss({})), agent: "magellan", fee_published_id: 501, expected: { live: false } });
    expect(cases[0].input).toMatchObject({ kind: "fresh_audit", audited_on: "2026-10-13" });
  });

  it("routes each miss as a half-weight wrong judgement from Deming", () => {
    const [row] = auditFeedback([miss({ check: NAME_QUALITY_CHECK, reason: "glyph_junk" })], "2026-10-13", 7);
    expect(row).toMatchObject({ aboutStage: "extract", signal: "wrong", kind: "audit_miss", reportedBy: "deming", weight: 0.5, runId: 7, dedupeKey: `deming.fresh_audit:501:${NAME_QUALITY_CHECK}` });
  });

  it("writes cases with the deming_audit label and reports a write the database refuses", async () => {
    const calls: string[] = [];
    const db = Object.assign(vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.join("?");
      calls.push(text);
      if (text.includes("SAVEPOINT") || text.includes("RELEASE") || text.includes("ROLLBACK")) return [];
      if (text.includes("INSERT INTO eval_cases")) {
        expect(values).toContain(AUDIT_LABEL);
        return [{ id: 1 }];
      }
      if (text.includes("INSERT INTO pipeline_feedback")) throw new Error("violates check constraint \"pipeline_feedback_reported_by_check\"");
      return [];
    }), { unsafe: vi.fn(async () => []) });
    const result = { readable: true, seed: "2026-10-13", misses: [miss({})] } as unknown as FreshAuditResult;
    const writes = await recordAuditMisses(db as never, result, { runId: 7 });
    expect(writes.cases).toBe(1);
    expect(writes.feedback).toBe(0);
    expect(writes.skipped[0]).toContain("owner feedback");
    expect(calls.some((text) => text.includes("INSERT INTO eval_cases"))).toBe(true);
  });

  it("writes nothing on a dry run", async () => {
    const db = vi.fn();
    const result = { readable: true, seed: "2026-10-13", misses: [miss({})] } as unknown as FreshAuditResult;
    expect(await recordAuditMisses(db as never, result, { runId: 7, dryRun: true })).toEqual({ cases: 0, feedback: 0, skipped: ["dry run"] });
    expect(db).not.toHaveBeenCalled();
  });
});

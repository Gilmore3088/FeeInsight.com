/**
 * Knox reads hand findings and Deming's audit misses filed against extract (lessons v5; #2057,
 * #2055, #2062), in real PostgreSQL, loopback only. Only this suite's own banks and names are
 * asserted.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { FEE_CORRECTION_CHECK } from "@/lib/fee-correction-rules";
import { FEE_HOLD_CHECK } from "@/lib/fee-hold-rules";
import { applyKnoxLesson, loadKnoxFindingsRead, loadKnoxLessons } from "./lessons";
import { loadLabelQueue } from "./label-queue";

const connection = process.env.E2E_DATABASE_URL;
const BANKS = [20570001, 20570002, 20570003, 20570004, 20570005, 20570006];
type Db = Parameters<typeof loadKnoxLessons>[0];

describe.skipIf(!connection)("Knox reads extract-stage holds, corrections and audit misses (#2057, #2055)", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let n = 0;

  async function row(fields: { kind: string; signal?: string; reportedBy: string; check: string; institution: number; key: string | null; feePublishedId?: number; evidence: Record<string, unknown>; stage?: string }) {
    n += 1;
    await raw`INSERT INTO pipeline_feedback (about_stage, signal, kind, reported_by, check_name, institution_id, fee_published_id, canonical_fee_key, weight, dedupe_key, evidence)
              VALUES (${fields.stage ?? "extract"}, ${fields.signal ?? "wrong"}, ${fields.kind}, ${fields.reportedBy}, ${fields.check}, ${fields.institution},
                      ${fields.feePublishedId ?? null}, ${fields.key}, 1, ${`test2057:${n}`}, ${raw.json(fields.evidence as never)})`;
  }
  const auditMiss = (institution: number, feeName: string, key: string, check = "hamilton.category_guard") =>
    row({ kind: "audit_miss", reportedBy: "deming", check, institution, key, evidence: { fee_name: feeName, reason: "test", owner: "knox" } });
  const correction = (institution: number, feeName: string, from: string, to: string, newId: number, check = FEE_CORRECTION_CHECK) =>
    row({
      kind: "admin_correction", reportedBy: check === FEE_CORRECTION_CHECK ? "human" : "gutenberg", check, institution, key: from,
      evidence: { action: "correct", cause: "wrong_category", new_fee_published_id: newId, before: { feeName, canonicalFeeKey: from }, after: { feeName, canonicalFeeKey: to } },
    });

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Knox lesson DB tests require a loopback E2E database; production connections are forbidden");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ANY(${BANKS})`;

    // A person's correction at bank 0: the statement copy is document reproduction, not a paper statement.
    await correction(BANKS[0], "Quokka Statement Copy", "paper_statement", "document_reproduction", 20570100);
    // Deming's category-guard misses of the same name at banks 1 and 2, and an amount miss that says nothing about the category.
    await auditMiss(BANKS[1], "Quokka Statement Copy", "paper_statement");
    await auditMiss(BANKS[2], "Quokka Statement Copy", "paper_statement");
    await auditMiss(BANKS[2], "Quokka Wire Out", "wire_domestic_outgoing", "hamilton.source_check");
    // Darwin verified it as document reproduction at bank 3.
    await row({ kind: "darwin_verified", signal: "right", reportedBy: "darwin", check: "darwin.verify", institution: BANKS[3], key: "document_reproduction", evidence: { fee_name: "Quokka Statement Copy" } });

    // A correction later reversed teaches nothing.
    await correction(BANKS[4], "Quokka Reversed Fee", "overdraft", "nsf", 20570200);
    await row({ kind: "admin_correction_reversed", signal: "restored", reportedBy: "human", check: FEE_CORRECTION_CHECK, institution: BANKS[4], key: "nsf", feePublishedId: 20570200, evidence: { action: "reverse" } });
    // The takedown sync's copy of a correction is not the person's finding.
    await correction(BANKS[5], "Quokka Mirror Fee", "overdraft", "nsf", 20570300, "hamilton.admin_correction");
    // A wrong-category hold, and an amount hold that says nothing about the category.
    await row({ kind: "admin_hold", reportedBy: "human", check: FEE_HOLD_CHECK, institution: BANKS[5], key: "check_printing", feePublishedId: 20570400, evidence: { cause: "wrong_category", fee_name: "Quokka Zipper Bags" } });
    await auditMiss(BANKS[4], "Quokka Zipper Bags", "check_printing");
    await row({ kind: "admin_hold", reportedBy: "human", check: FEE_HOLD_CHECK, institution: BANKS[5], key: "overdraft", feePublishedId: 20570500, evidence: { cause: "wrong_amount", fee_name: "Quokka Overdraft" } });
  });

  afterAll(async () => {
    if (raw) {
      await raw`DELETE FROM pipeline_feedback WHERE institution_id = ANY(${BANKS})`;
      await raw.end();
    }
  });

  it("learns a seeded extract correction and audit misses as category verdicts", async () => {
    const lessons = await loadKnoxLessons(raw as unknown as Db);
    const all = [...lessons.values()];
    // The correction alone teaches its own bank; with the audit misses and Darwin's verdict it is global.
    expect(all).toContainEqual(expect.objectContaining({ institutionId: BANKS[0], name: "quokka statement copy", wrongKey: "paper_statement", rightKey: "document_reproduction" }));
    expect(all).toContainEqual(expect.objectContaining({ institutionId: null, name: "quokka statement copy", wrongKey: "paper_statement", rightKey: "document_reproduction", wrongBanks: 3, rightBanks: 2 }));
    const candidate = { feeName: "Quokka Statement Copy", amount: 5, frequency: null, canonicalHint: "paper_statement", confidence: 0.8, excerpt: "", waivable: false };
    expect(applyKnoxLesson(candidate, lessons).lessonFlag).toBe("knox_lesson:paper_statement->document_reproduction");
    // A reversed correction and the sync's copy teach nothing.
    expect(all.some((lesson) => lesson.name === "quokka reversed fee" || lesson.name === "quokka mirror fee")).toBe(false);
  });

  it("lists a name only findings rejected for a person's label", async () => {
    const queue = await loadLabelQueue(raw as unknown as Db, 1000);
    expect(queue).toContainEqual(expect.objectContaining({ name: "quokka zipper bags", reason: "never_verified", banks: 2 }));
    expect(queue.some((entry) => entry.name === "quokka overdraft" || entry.name === "quokka mirror fee")).toBe(false);
  });

  it("counts what it read by kind and verdict for the extract step", async () => {
    const read = await loadKnoxFindingsRead(raw as unknown as Db);
    expect(read.admin_correction?.category).toBeGreaterThanOrEqual(1);
    expect(read.admin_correction?.withdrawn).toBeGreaterThanOrEqual(1);
    expect(read.audit_miss?.category).toBeGreaterThanOrEqual(3);
    expect(read.audit_miss?.no_category_verdict).toBeGreaterThanOrEqual(1);
    expect(read.admin_hold?.category).toBeGreaterThanOrEqual(1);
    expect(read.admin_hold?.no_category_verdict).toBeGreaterThanOrEqual(1);
  });
});

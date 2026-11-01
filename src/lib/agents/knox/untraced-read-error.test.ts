import { describe, expect, it, vi } from "vitest";
import { FEEDBACK_KINDS } from "@/lib/agents/learning/feedback-kinds";
import { HELD_SET_ASIDE_AFTER_VERSIONS } from "./held-recheck";
import { shapeInfo } from "./held-queue";
import {
  reportUntracedToRosetta,
  UNTRACED_READ_ERROR_AFTER_VERSIONS,
  UNTRACED_READ_ERROR_CHECK,
  UNTRACED_READ_ERROR_KIND,
  untracedReadErrorFeedback,
  untracedReadErrorNote,
  type UntracedTextRow,
} from "./untraced-read-error";

const ROW: UntracedTextRow = {
  text_id: "77",
  source_document_id: "501",
  institution_id: "9",
  source_url: "https://bank.test/fees.pdf",
  text_hash: "hash-a",
  reader: "read.pdf_layout",
  lines: "3",
  fee_raw_ids: ["11", "12", "13"],
  examples: [{ fee_name: "Safe Deposit Box Annual Fees: Each", amount: "40.00" }],
};

describe("untraced held lines go back to Rosetta (#1102)", () => {
  it("waits as long as the held queue counts a line as one its re-check is not shrinking", () => {
    expect(UNTRACED_READ_ERROR_AFTER_VERSIONS).toBe(HELD_SET_ASIDE_AFTER_VERSIONS);
  });

  it("writes one possible read error about the text, in the shape Rosetta's read step selects", () => {
    const row = untracedReadErrorFeedback(ROW, 42);
    expect(row).toMatchObject({
      aboutStage: "read",
      aboutStrategy: "read.pdf_layout",
      signal: "wrong",
      kind: UNTRACED_READ_ERROR_KIND,
      reportedBy: "knox",
      checkName: UNTRACED_READ_ERROR_CHECK,
      institutionId: 9,
      sourceDocumentId: 501,
      runId: 42,
      dedupeKey: "knox.untraced_held:doc:501:hash-a",
    });
    // Rosetta's selection needs weight above 0 and the text's hash.
    expect(row.weight).toBeGreaterThan(0);
    expect(row.weight).toBeLessThan(1);
    expect(row.evidence).toMatchObject({ text_hash: "hash-a", untraced_lines: 3, fee_raw_ids: [11, 12, 13] });
    expect(row.evidence?.examples).toEqual([{ fee_name: "Safe Deposit Box Annual Fees: Each", amount: 40 }]);
  });

  it("is registered with Rosetta's read step as its reader", () => {
    expect(FEEDBACK_KINDS[UNTRACED_READ_ERROR_KIND]).toMatchObject({ readers: ["src/lib/agents/rosetta/read.ts"], readStages: ["read"] });
  });

  it("names Rosetta as the untraced pile's next owner, with its way out", () => {
    expect(shapeInfo("untraced").wayOut).toContain("goes to Rosetta");
  });

  it("counts on a dry run and writes nothing", async () => {
    const calls: string[] = [];
    const db = vi.fn(async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      calls.push(text);
      if (text.includes("to_regclass")) return [{ ready: true }];
      if (text.includes("WITH held AS")) return [ROW, { ...ROW, text_id: 78, source_document_id: 502, text_hash: "hash-b", lines: 1, institution_id: 10 }];
      throw new Error(`unexpected query: ${text.slice(0, 80)}`);
    }) as never;
    const result = await reportUntracedToRosetta(db, { runId: 1, dryRun: true, limit: 1 });
    expect(result).toMatchObject({ dryRun: true, candidates: 2, candidateLines: 4, institutions: 2, reported: 1, reportedLines: 3 });
    expect(calls.some((text) => text.includes("INSERT INTO pipeline_feedback"))).toBe(false);
    expect(untracedReadErrorNote(result)).toContain("would be sent to Rosetta");
  });

  it("says nothing when no text is waiting", () => {
    expect(untracedReadErrorNote({ ready: true, dryRun: false, candidates: 0, candidateLines: 0, institutions: 0, reported: 0, reportedLines: 0 })).toBe("");
  });
});

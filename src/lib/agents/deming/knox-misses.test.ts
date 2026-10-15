import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { gateKeyFor, gateReads, scoreAnswerKeys, type AnswerKeyDocument } from "@/lib/agents/knox/answer-key-gate";
import { caseKeyFor, judgeBank, knoxMissesDetail, rightDocumentIds, rotationOrder, runKnoxMisses, summarizeKnoxMisses, type KeyFee } from "./knox-misses";

const TEXT = ["Fee Schedule", "Stop Payment Fee | $30.00", "Overdraft Fee | $35.00 per item"].join("\n");

const fee = (overrides: Partial<KeyFee>): KeyFee => ({
  feeId: 1,
  institutionId: 7,
  documentUrl: "https://www.bank.example/fees.pdf",
  documentType: "text_pdf",
  canonicalKey: "stop_payment",
  amount: 30,
  amountKind: "fixed",
  sourceLine: "Stop Payment Fee | $30.00",
  ...overrides,
});

describe("Deming's replay of Knox's answer-key misses (#1099)", () => {
  it("judges each key fee as the Knox gate scores it", () => {
    const verdicts = judgeBank(
      [
        fee({}),
        fee({ feeId: 2, canonicalKey: "wire_domestic_outgoing", amount: 25, sourceLine: "Outgoing wire $25.00" }),
        fee({ feeId: 3, canonicalKey: "safe_deposit_box", amount: null, amountKind: "varies" }),
      ],
      { textId: 9, sourceDocumentId: 11, textHash: "h", text: TEXT },
    );
    expect(verdicts.map((row) => row.verdict)).toEqual(["read", "missed", "not_scored"]);
    expect(verdicts[0].gateKey).toBe("stop_payment:3000");
    expect(judgeBank([fee({})], null)[0].verdict).toBe("no_text");
  });

  it("finds the key's document by its address or its bytes", () => {
    const docs = [
      { id: 1, url: "http://bank.example/fees.pdf", contentHash: "a" },
      { id: 2, url: "https://bank.example/other.pdf", contentHash: "a" },
      { id: 3, url: "https://bank.example/rates.pdf", contentHash: "b" },
    ];
    expect(rightDocumentIds("https://www.bank.example/fees.pdf", null, docs)).toEqual([1, 2]);
    expect(rightDocumentIds("https://www.bank.example/x.pdf", "b", docs)).toEqual([3]);
  });

  it("counts a fee found as the gate does, on real answer-key documents", () => {
    const fixture = JSON.parse(
      gunzipSync(readFileSync(join(process.cwd(), "src/lib/agents/knox/__fixtures__/texas-answer-keys.json.gz"))).toString("utf8"),
    ) as { keys: AnswerKeyDocument[] };
    for (const document of fixture.keys.slice(0, 3)) {
      const reads = gateReads(document.text);
      const keys = new Set(document.fees.map((row) => gateKeyFor(row, document.text)).filter((key): key is string => key != null));
      const found = [...keys].filter((key) => reads.has(key)).length;
      expect(found).toBe(scoreAnswerKeys([document]).found);
    }
  }, 60_000);

  function fakeDb(state: {
    keys: Array<Record<string, unknown>>;
    cases?: Array<Record<string, unknown>>;
    documents?: Array<Record<string, unknown>>;
    text?: Record<string, unknown> | null;
  }) {
    const writes: Array<{ text: string; values: unknown[] }> = [];
    const tag = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (text.includes("to_regclass")) return [{ ready: true }];
      if (text.includes("FROM answer_key_fees")) return state.keys;
      if (text.includes("FROM eval_cases")) return state.cases ?? [];
      if (text.includes("FROM agent_run_steps")) return [];
      if (text.includes("FROM source_documents")) return state.documents ?? [{ id: 11, institution_id: 7, document_url: "https://bank.example/fees.pdf", content_hash: null }];
      if (text.includes("FROM agent_source_texts")) return state.text === null ? [] : [state.text ?? { id: 9, institution_id: 7, source_document_id: 11, text_hash: "h", normalized_text: TEXT }];
      writes.push({ text, values });
      if (text.includes("INSERT INTO eval_cases")) return JSON.parse(String(values.find((value) => typeof value === "string" && value.startsWith("[")))).map((_: unknown, id: number) => ({ id }));
      return [];
    });
    // inSavepoint runs its callback on the same tag in tests.
    const db = Object.assign(tag, { begin: undefined, savepoint: (fn: (scope: typeof tag) => unknown) => fn(tag) });
    return { db, writes };
  }

  const keyRow = (id: number, key: string, amount: number | null, kind = "fixed") => ({
    fee_id: id, institution_id: 7, document_url: "https://bank.example/fees.pdf", document_type: "text_pdf", content_hash: null,
    canonical_key: key, amount, amount_kind: kind, source_line: `${key} $${amount}`,
  });

  it("adds a case for each new miss, activates a case now read, flags a regression and retires a removed fee", async () => {
    const { db, writes } = fakeDb({
      keys: [keyRow(1, "stop_payment", 30), keyRow(2, "wire_domestic_outgoing", 25), keyRow(3, "overdraft", 35), keyRow(4, "nsf", 29)],
      cases: [
        { case_key: caseKeyFor(1), status: "candidate", institution_id: 7, last_checked_at: null },
        { case_key: caseKeyFor(4), status: "active", institution_id: 7, last_checked_at: null },
        { case_key: caseKeyFor(99), status: "candidate", institution_id: 7, last_checked_at: null },
      ],
    });
    const result = await runKnoxMisses({ db: db as never, runId: 5 });
    expect(result).toMatchObject({
      ready: true, banksRead: 1, feesScored: 4, feesRead: 2, feesMissed: 2, missRate: 0.5,
      newCases: 1, activated: 1, retired: 1,
      regressions: [{ caseKey: caseKeyFor(4), institutionId: 7, fee: "nsf 29" }],
      byCategory: { nsf: { expected: 1, missed: 1, missRate: 1 }, stop_payment: { expected: 1, missed: 0, missRate: 0 } },
      byDocumentType: { text_pdf: { expected: 4, missed: 2, missRate: 0.5 } },
    });
    const insert = writes.find((write) => write.text.includes("INSERT INTO eval_cases"))!;
    const inserted = JSON.parse(String(insert.values.find((value) => typeof value === "string" && value.startsWith("["))));
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      case_key: caseKeyFor(2),
      source_document_id: 11,
      source_text_hash: "h",
      input: { kind: "knox_answer_key_read", answer_key_fee_id: 2, canonical_key: "wire_domestic_outgoing", amount: 25, text_hash: "h" },
      expected: { read: true, gate_key: "wire_domestic_outgoing:2500" },
    });
    expect(insert.text).toContain("'golden', 'candidate', 'knox'");
    expect(insert.text).toContain("'answer_key'");
    const replay = writes.find((write) => write.text.includes("last_verdict = r.verdict"))!;
    expect(JSON.parse(String(replay.values.find((value) => typeof value === "string" && value.startsWith("["))))).toEqual([
      { case_key: caseKeyFor(1), verdict: "read" },
      { case_key: caseKeyFor(4), verdict: "missed" },
    ]);
    expect(writes.find((write) => write.text.includes("SET status = 'retired'"))?.values).toContainEqual([caseKeyFor(99)]);
    // Only Deming's case store is written.
    for (const write of writes) expect(write.text).not.toMatch(/raw_fee_observations|verified_fee_observations|published_fee_records/);
    expect(summarizeKnoxMisses(result)).toContain("2 of 4 key fees missed (50.0%)");
    expect(summarizeKnoxMisses(result)).toContain("1 REGRESSION");
    expect(knoxMissesDetail(result)).toMatchObject({ fees_missed: 2, new_cases: 1, activated: 1, retired: 1 });
  });

  it("writes nothing on a dry run, and counts a bank with no text apart from Knox's misses", async () => {
    const { db, writes } = fakeDb({ keys: [keyRow(1, "stop_payment", 31)], text: null });
    const result = await runKnoxMisses({ db: db as never, runId: 5, dryRun: true });
    expect(result).toMatchObject({ banksRead: 0, banksNoText: 1, feesScored: 0, feesMissed: 0, newCases: 0 });
    expect(writes).toHaveLength(0);
  });

  it("reopens a retired case whose key fee is confirmed again, and keeps replaying a case the gate no longer scores", async () => {
    const { db, writes } = fakeDb({
      keys: [keyRow(2, "wire_domestic_outgoing", 25), keyRow(1, "stop_payment", 30), keyRow(3, "safe_deposit_box", null, "varies")],
      cases: [
        { case_key: caseKeyFor(2), status: "retired", institution_id: 7, last_checked_at: null },
        { case_key: caseKeyFor(1), status: "retired", institution_id: 7, last_checked_at: null },
        { case_key: caseKeyFor(3), status: "candidate", institution_id: 7, last_checked_at: null },
      ],
    });
    const result = await runKnoxMisses({ db: db as never, runId: 6 });
    expect(result).toMatchObject({ reopened: 2, newCases: 0, retired: 0 });
    const replay = writes.find((write) => write.text.includes("last_verdict = r.verdict"))!;
    expect(replay.text).toContain("WHEN e.status = 'retired' AND r.verdict = 'missed' THEN 'candidate'");
    expect(replay.text).toContain("WHEN e.status = 'retired' AND r.verdict = 'read' THEN 'active'");
    expect(JSON.parse(String(replay.values.find((value) => typeof value === "string" && value.startsWith("["))))).toEqual([
      { case_key: caseKeyFor(2), verdict: "missed" },
      { case_key: caseKeyFor(1), verdict: "read" },
      { case_key: caseKeyFor(3), verdict: "not_scored" },
    ]);
    expect(writes.some((write) => write.text.includes("SET status = 'retired'"))).toBe(false);
  });

  it("rotates banks: the ones the last run did not reach first, and a bank with no case is not always first", () => {
    const at = (iso: string) => ({ institution_id: 0, last_checked_at: iso, status: "candidate" });
    const cases = [
      { ...at("2026-10-14T12:29:00Z"), institution_id: 1 },
      { ...at("2026-10-16T12:29:00Z"), institution_id: 2 },
      { ...at("2026-10-15T12:29:00Z"), institution_id: 3, status: "retired" },
    ];
    // Bank 3 has only a retired case and bank 4 none: both count as checked at the last run.
    const previous = { at: "2026-10-15T12:35:00Z", detail: { banks_left_ids: [5] } };
    expect(rotationOrder([1, 2, 3, 4, 5], cases, previous)).toEqual([5, 1, 3, 4, 2]);
    expect(rotationOrder([4, 1], cases, null)).toEqual([4, 1]);
  });

  it("leaves banks for the next day once the budget is spent", async () => {
    let clock = 0;
    const { db } = fakeDb({ keys: [keyRow(1, "stop_payment", 30)] });
    const result = await runKnoxMisses({ db: db as never, runId: 5, dryRun: true, now: () => (clock += 1000), budgetMs: 500 });
    expect(result).toMatchObject({ banksRead: 0, banksLeft: 1, banksLeftIds: [7] });
    expect(knoxMissesDetail(result).banks_left_ids).toEqual([7]);
  });
});

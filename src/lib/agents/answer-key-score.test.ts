import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import {
  amountMatches,
  normalizeDocumentUrl,
  rawCanonicalHint,
  scoreAnswerKey,
  summarizeAnswerKeyScore,
  type BankEvidence,
} from "./answer-key-score";
import type { ConfirmedAnswerKeyEntry } from "@/lib/data-store/answer-key";
import { narrateEvent } from "./narrate";

const ENTRY: ConfirmedAnswerKeyEntry = {
  institutionId: 7,
  documentUrl: "https://www.example-bank.com/fees/",
  documentType: "html",
  contentHash: null,
  fees: [
    { canonicalKey: "overdraft", amount: 32, amountKind: "fixed" },
    { canonicalKey: "nsf", amount: 30, amountKind: "fixed" },
    { canonicalKey: "estatement_fee", amount: 0, amountKind: "free" },
    { canonicalKey: "safe_deposit_box", amount: null, amountKind: "varies" },
  ],
};

function evidence(overrides: Partial<BankEvidence> = {}): BankEvidence {
  const fees = [
    { canonicalKey: "overdraft", amount: 32 },
    { canonicalKey: "nsf", amount: 30.004 },
    { canonicalKey: "estatement_fee", amount: 0 },
    { canonicalKey: "safe_deposit_box", amount: 45 },
  ];
  return {
    institutionId: 7,
    feeScheduleUrl: "http://example-bank.com/fees",
    documents: [{ id: 11, url: "http://example-bank.com/fees", contentHash: "abc" }],
    latestText: { sourceDocumentId: 11, status: "completed", charCount: 900 },
    knox: fees,
    darwin: fees,
    hamilton: fees,
    ...overrides,
  };
}

describe("normalizeDocumentUrl", () => {
  it("ignores scheme, www, case, trailing slash, fragment and tracking params", () => {
    expect(normalizeDocumentUrl("https://www.Example.com/Fees/?utm_source=x#top")).toBe("example.com/fees");
    expect(normalizeDocumentUrl("example.com/fees")).toBe("example.com/fees");
    expect(normalizeDocumentUrl("https://example.com/f.pdf?b=2&a=1")).toBe("example.com/f.pdf?a=1&b=2");
    expect(normalizeDocumentUrl("  ")).toBeNull();
  });
});

describe("amountMatches", () => {
  it("allows one cent, treats free as $0 and varies as any amount", () => {
    expect(amountMatches({ amount: 32, amountKind: "fixed" }, 32.01)).toBe(true);
    expect(amountMatches({ amount: 32, amountKind: "fixed" }, 32.02)).toBe(false);
    expect(amountMatches({ amount: 0, amountKind: "free" }, 0)).toBe(true);
    expect(amountMatches({ amount: 0, amountKind: "free" }, null)).toBe(false);
    expect(amountMatches({ amount: null, amountKind: "varies" }, 99)).toBe(true);
  });
});

describe("rawCanonicalHint", () => {
  it("reads Knox's hint from flags, then conditions", () => {
    expect(rawCanonicalHint(["needs_darwin_verification", "canonical_hint:overdraft"], null)).toBe("overdraft");
    expect(rawCanonicalHint(JSON.stringify(["canonical_hint:nsf"]), null)).toBe("nsf");
    expect(rawCanonicalHint([], "Knox … canonical_hint=stop_payment; text_hash=x;")).toBe("stop_payment");
    expect(rawCanonicalHint([], "canonical_hint=none;")).toBeNull();
  });
});

describe("scoreAnswerKey", () => {
  it("scores a perfect pipeline at precision and recall 1 on every stage", () => {
    const score = scoreAnswerKey([ENTRY], new Map([[7, evidence()]]));
    expect(score.overall).toMatchObject({ precision: 1, recall: 1, expected: 4 });
    for (const stage of ["magellan", "rosetta", "knox", "darwin", "hamilton"] as const) {
      expect(score.byStage[stage], stage).toMatchObject({ precision: 1, recall: 1 });
    }
    expect(score.byDocumentType.html.banks).toBe(1);
    expect(score.byCategory.overdraft).toMatchObject({ precision: 1, recall: 1, family: "Overdraft & NSF" });
    expect(score.banks[0]).toMatchObject({ precision: 1, recall: 1, missing: [], extra: [] });
  });

  it("finds the right document by content hash when the URL differs", () => {
    const score = scoreAnswerKey(
      [{ ...ENTRY, contentHash: "abc" }],
      new Map([[7, evidence({ documents: [{ id: 12, url: "https://cdn.example.com/x.html", contentHash: "abc" }], latestText: { sourceDocumentId: 12, status: "completed", charCount: 10 } })]]),
    );
    expect(score.byStage.magellan.recall).toBe(1);
    expect(score.byStage.rosetta.recall).toBe(1);
  });

  it("counts a wrong document, a missing text, wrong amounts and extra fees", () => {
    const score = scoreAnswerKey(
      [ENTRY],
      new Map([[7, evidence({
        documents: [{ id: 13, url: "https://example-bank.com/rates", contentHash: "zzz" }],
        latestText: { sourceDocumentId: 13, status: "wrong_document", charCount: 500 },
        knox: [{ canonicalKey: "overdraft", amount: 32 }, { canonicalKey: "overdraft", amount: 32 }, { canonicalKey: "nsf", amount: 35 }],
        darwin: [{ canonicalKey: "overdraft", amount: 32 }],
        hamilton: [{ canonicalKey: "overdraft", amount: 32 }, { canonicalKey: "stop_payment", amount: 30 }],
      })]]),
    );
    expect(score.byStage.magellan).toMatchObject({ predicted: 1, correct: 0, precision: 0, recall: 0 });
    expect(score.byStage.rosetta).toMatchObject({ predicted: 0, precision: null, recall: 0 });
    // Duplicate overdraft rows count once; nsf $35 is wrong.
    expect(score.byStage.knox).toMatchObject({ predicted: 2, correct: 1, matched: 1, precision: 0.5, recall: 0.25 });
    expect(score.byStage.darwin).toMatchObject({ precision: 1, recall: 0.25 });
    expect(score.overall).toMatchObject({ precision: 0.5, recall: 0.25 });
    expect(score.byCategory.stop_payment).toMatchObject({ predicted: 1, correct: 0, precision: 0, expected: 0, recall: null });
    expect(score.banks[0].missing).toEqual(["nsf $30.00", "estatement_fee $0.00", "safe_deposit_box"]);
    expect(score.banks[0].extra).toEqual(["stop_payment $30.00"]);
  });

  it("scores a bank the pipeline never touched as zero recall", () => {
    const score = scoreAnswerKey([{ ...ENTRY, documentType: "scanned_pdf" }], new Map());
    expect(score.overall).toMatchObject({ recall: 0, precision: null });
    expect(score.byDocumentType.scanned_pdf.stages.magellan.recall).toBe(0);
  });

  it("summarizes and narrates", () => {
    const score = scoreAnswerKey([ENTRY], new Map([[7, evidence()]]));
    expect(summarizeAnswerKeyScore({ schemaReady: true, scoreRunId: 1, score, dryRun: false }))
      .toContain("precision 100.0%, recall 100.0%");
    expect(summarizeAnswerKeyScore({ schemaReady: false, scoreRunId: null, score: null, dryRun: false }))
      .toContain("not applied");
    expect(narrateEvent({
      eventType: "step.finished",
      status: "completed",
      message: "",
      detail: { banks_scored: 3, precision: 0.9, recall: 0.75 },
      stepKey: "score-answer-key",
      stateCode: null,
    })).toBe("Scored the pipeline against 3 hand-checked banks: 90.0% precision, 75.0% recall.");
    expect(narrateEvent({
      eventType: "step.finished",
      status: "completed",
      message: "",
      detail: { stored: true, coverage: { rate: 0.5 }, accuracy: { precision: null } },
      stepKey: "scoreboard-snapshot",
      stateCode: null,
    })).toBe("Recorded the daily scoreboard: coverage 50.0%, accuracy n/a precision.");
  });
});

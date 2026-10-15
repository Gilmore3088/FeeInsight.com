import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import {
  amountMatches,
  normalizeDocumentUrl,
  rawCanonicalHint,
  scoreAnswerKey,
  summarizeAnswerKeyScore,
  topKnoxMisses,
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

const KEY_DOC_FEES = [
  { canonicalKey: "overdraft", amount: 32, sourceDocumentId: 11 },
  { canonicalKey: "nsf", amount: 30.004, sourceDocumentId: 11 },
  { canonicalKey: "estatement_fee", amount: 0, sourceDocumentId: 11 },
  { canonicalKey: "safe_deposit_box", amount: 45, sourceDocumentId: 11 },
];

function evidence(overrides: Partial<BankEvidence> = {}): BankEvidence {
  const latestText = overrides.latestText === undefined
    ? { sourceDocumentId: 11, status: "completed", charCount: 900 }
    : overrides.latestText;
  return {
    institutionId: 7,
    feeScheduleUrl: "http://example-bank.com/fees",
    documents: [{ id: 11, url: "http://example-bank.com/fees", contentHash: "abc" }],
    latestText,
    texts: latestText ? [latestText] : [],
    knox: KEY_DOC_FEES,
    darwin: KEY_DOC_FEES,
    hamilton: KEY_DOC_FEES,
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
  it.each([1, 2, 3] as const)("scores a perfect pipeline at precision and recall 1 on every stage (v%i)", (version) => {
    const score = scoreAnswerKey([ENTRY], new Map([[7, evidence()]]), version);
    expect(score.scorerVersion).toBe(version);
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

  it("counts a wrong document, a missing text, wrong amounts and extra fees (v1)", () => {
    const score = scoreAnswerKey(
      [ENTRY],
      new Map([[7, evidence({
        documents: [{ id: 13, url: "https://example-bank.com/rates", contentHash: "zzz" }],
        latestText: { sourceDocumentId: 13, status: "wrong_document", charCount: 500 },
        knox: [{ canonicalKey: "overdraft", amount: 32 }, { canonicalKey: "overdraft", amount: 32 }, { canonicalKey: "nsf", amount: 35 }],
        darwin: [{ canonicalKey: "overdraft", amount: 32 }],
        hamilton: [{ canonicalKey: "overdraft", amount: 32 }, { canonicalKey: "stop_payment", amount: 30 }],
      })]]),
      1,
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

  it("v2 scores the bank's link and the key's own document; v1 the newest page and every document (#1280)", () => {
    // The link is the key's document (11); a newer overdraft page (14) was stored beside it.
    const bank = evidence({
      documents: [
        { id: 14, url: "https://example-bank.com/overdraft-protection/", contentHash: "new" },
        { id: 11, url: "http://example-bank.com/fees", contentHash: "abc" },
      ],
      latestText: { sourceDocumentId: 14, status: "completed", charCount: 400 },
      texts: [
        { sourceDocumentId: 14, status: "completed", charCount: 400 },
        { sourceDocumentId: 11, status: "completed", charCount: 900 },
      ],
      hamilton: [
        ...KEY_DOC_FEES,
        { canonicalKey: "monthly_maintenance", amount: 15, sourceDocumentId: 14 },
        { canonicalKey: "stop_payment", amount: 30, sourceDocumentId: null },
      ],
    });
    const v1 = scoreAnswerKey([ENTRY], new Map([[7, bank]]), 1);
    const v2 = scoreAnswerKey([ENTRY], new Map([[7, bank]]), 2);
    expect([v1.byStage.magellan.recall, v1.byStage.rosetta.recall, v1.overall.precision]).toEqual([0, 0, 0.6667]);
    expect([v2.byStage.magellan.recall, v2.byStage.rosetta.recall]).toEqual([1, 1]);
    expect(v2.overall).toMatchObject({ predicted: 4, correct: 4, precision: 1, recall: 1, otherDocument: 1, noDocument: 1 });
    expect(v2.banks[0].stages.hamilton).toMatchObject({ otherDocument: 1, noDocument: 1 });
    expect(v1.overall.otherDocument).toBeUndefined();
    // A link to the wrong page is a wrong Magellan prediction under v2.
    const wrongLink = scoreAnswerKey([ENTRY], new Map([[7, { ...bank, feeScheduleUrl: "https://example-bank.com/overdraft-protection" }]]), 2);
    expect(wrongLink.byStage.magellan).toMatchObject({ predicted: 1, correct: 0 });
  });

  it("v3 counts a fee published as a rate only against a key fee keyed as varies, never a dollar amount", () => {
    // safe_deposit_box is keyed as varies; the key's overdraft is $32, never a rate.
    const bank = evidence({
      hamilton: KEY_DOC_FEES.filter((fee) => fee.canonicalKey !== "safe_deposit_box"),
      hamiltonRates: [
        { canonicalKey: "safe_deposit_box", amount: null, ratePercent: 1.5, sourceDocumentId: 11 },
        { canonicalKey: "safe_deposit_box", amount: null, ratePercent: 1.5, sourceDocumentId: 11 },
        { canonicalKey: "overdraft", amount: null, ratePercent: 32, sourceDocumentId: 11 },
      ],
    });
    const v2 = scoreAnswerKey([ENTRY], new Map([[7, bank]]), 2);
    const v3 = scoreAnswerKey([ENTRY], new Map([[7, bank]]), 3);
    expect(v2.overall).toMatchObject({ predicted: 3, correct: 3, matched: 3, recall: 0.75 });
    expect(v2.banks[0].missing).toEqual(["safe_deposit_box"]);
    // The repeated rate counts once; a 32% overdraft rate does not meet the $32 key fee.
    expect(v3.overall).toMatchObject({ predicted: 5, correct: 4, matched: 4, recall: 1, precision: 0.8 });
    expect(v3.banks[0].missing).toEqual([]);
    expect(v3.banks[0].extra).toEqual(["overdraft 32%"]);
    // Knox and Darwin are unchanged by the rate catalog.
    expect(v3.byStage.knox).toEqual(v2.byStage.knox);
  });

  it("scores a bank the pipeline never touched as zero recall", () => {
    const score = scoreAnswerKey([{ ...ENTRY, documentType: "scanned_pdf" }], new Map());
    expect(score.overall).toMatchObject({ recall: 0, precision: null });
    expect(score.byDocumentType.scanned_pdf.stages.magellan.recall).toBe(0);
  });

  it("counts Knox's misses only where Rosetta read the right document, by category and type (#1099)", () => {
    // Knox read the overdraft and the free e-statement, missed the NSF fee and the box.
    const knox = [KEY_DOC_FEES[0], KEY_DOC_FEES[2], { canonicalKey: "nsf", amount: 25, sourceDocumentId: 11 }];
    const second: ConfirmedAnswerKeyEntry = { ...ENTRY, institutionId: 8, documentType: "text_pdf" };
    const score = scoreAnswerKey(
      [ENTRY, second],
      new Map([
        [7, evidence({ knox })],
        // Bank 8's text never completed: its misses are Rosetta's, not Knox's.
        [8, evidence({ institutionId: 8, knox: [], latestText: { sourceDocumentId: 11, status: "failed", charCount: 0 } })],
      ]),
    );
    expect(score.knoxMisses).toMatchObject({
      banks: 1,
      overall: { expected: 4, missed: 2, missRate: 0.5 },
      byDocumentType: { html: { expected: 4, missed: 2 } },
    });
    // The $25 NSF row does not match the key's $30, and no Knox row is a safe deposit box.
    expect(score.knoxMisses.byCategory.nsf).toEqual({ expected: 1, missed: 1, missRate: 1 });
    expect(score.knoxMisses.byCategory.safe_deposit_box).toEqual({ expected: 1, missed: 1, missRate: 1 });
    expect(score.knoxMisses.byCategory.overdraft).toEqual({ expected: 1, missed: 0, missRate: 0 });
    expect(score.knoxMisses.byDocumentType.text_pdf).toBeUndefined();
    expect(score.banks[0].knox_missed).toEqual(["nsf $30.00", "safe_deposit_box"]);
    expect(score.banks[1].knox_missed).toEqual([]);
    expect(topKnoxMisses(score.knoxMisses).map((row) => row.category)).toEqual(["nsf", "safe_deposit_box"]);
    expect(summarizeAnswerKeyScore({ schemaReady: true, scoreRunId: 1, score, dryRun: false }))
      .toContain("On the 1 documents Rosetta read right, Knox missed 2 of 4 key fees (50.0%); most in nsf 1/1, safe_deposit_box 1/1.");
  });

  it("summarizes and narrates", () => {
    const score = scoreAnswerKey([ENTRY], new Map([[7, evidence()]]));
    const v1 = scoreAnswerKey([ENTRY], new Map([[7, evidence()]]), 1);
    const summary = summarizeAnswerKeyScore({
      schemaReady: true,
      scoreRunId: 2,
      score,
      series: [{ scorerVersion: 1, scoreRunId: 1, score: v1 }, { scorerVersion: 3, scoreRunId: 3, score }],
      dryRun: false,
    });
    expect(summary).toContain("with scorer v3: precision 100.0%, recall 100.0%");
    expect(summary).toContain("Scorer v1: precision 100.0%, recall 100.0%.");
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

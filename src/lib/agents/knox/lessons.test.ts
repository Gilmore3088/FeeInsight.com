import { describe, expect, it } from "vitest";
import { applyKnoxLesson, LABEL_WRONG_KEY, lessonName, lessonsFrom, type KnoxLesson } from "@/lib/agents/knox/lessons";
import type { ExtractedFeeCandidate } from "@/lib/agents/knox/rules";

const lesson = (name: string, wrongKey: string, rightKey: string): KnoxLesson => ({ name, wrongKey, rightKey, wrongBanks: 3, rightBanks: 3 });

function fee(feeName: string, canonicalHint: string): ExtractedFeeCandidate {
  return { feeName, amount: 10, frequency: null, canonicalHint, confidence: 0.82, excerpt: `${feeName} $10.00`, waivable: false };
}

describe("Knox learning reader", () => {
  it("keys names the way the store does: letters only, lowercase", () => {
    expect(lessonName("Overdraft Transfers*")).toBe("overdraft transfers");
    expect(lessonName("  Paid NSF Fee (per item) ")).toBe("paid nsf fee per item");
  });

  it("re-files a name the guards reject under the rules' category and verify under another", () => {
    const lessons = lessonsFrom([lesson("overdraft transfers", "overdraft", "od_protection_transfer")]);
    const applied = applyKnoxLesson(fee("Overdraft Transfers", "overdraft"), lessons);
    expect(applied.candidate.canonicalHint).toBe("od_protection_transfer");
    expect(applied.lessonFlag).toBe("knox_lesson:overdraft->od_protection_transfer");
  });

  it("leaves other names, and the same name under another category, alone", () => {
    const lessons = lessonsFrom([lesson("overdraft transfers", "overdraft", "od_protection_transfer")]);
    expect(applyKnoxLesson(fee("Overdraft Fee", "overdraft"), lessons).lessonFlag).toBeNull();
    expect(applyKnoxLesson(fee("Overdraft Transfers", "nsf"), lessons).lessonFlag).toBeNull();
  });

  it("learns nothing when a rejected name was verified under two different categories", () => {
    const lessons = lessonsFrom([lesson("statement copy", "paper_statement", "document_reproduction"), lesson("statement copy", "paper_statement", "check_image")]);
    expect(lessons.size).toBe(0);
  });
});

describe("Knox per-bank memory", () => {
  const bankLesson = (institutionId: number, name: string, wrongKey: string, rightKey: string): KnoxLesson => ({
    institutionId,
    name,
    wrongKey,
    rightKey,
    wrongBanks: 1,
    rightBanks: 1,
  });

  it("applies a bank's own lesson only at that bank", () => {
    const lessons = lessonsFrom([bankLesson(4956, "courtesy pay", "nsf", "overdraft")]);
    const applied = applyKnoxLesson(fee("Courtesy Pay", "nsf"), lessons, 4956);
    expect(applied.candidate.canonicalHint).toBe("overdraft");
    expect(applied.lessonFlag).toBe("knox_lesson:nsf->overdraft");
    expect(applyKnoxLesson(fee("Courtesy Pay", "nsf"), lessons, 31).lessonFlag).toBeNull();
    expect(applyKnoxLesson(fee("Courtesy Pay", "nsf"), lessons).lessonFlag).toBeNull();
  });

  it("prefers the bank's lesson over the global one", () => {
    const lessons = lessonsFrom([
      lesson("statement copy", "paper_statement", "document_reproduction"),
      bankLesson(97, "statement copy", "paper_statement", "check_image"),
    ]);
    expect(applyKnoxLesson(fee("Statement Copy", "paper_statement"), lessons, 97).candidate.canonicalHint).toBe("check_image");
    expect(applyKnoxLesson(fee("Statement Copy", "paper_statement"), lessons, 98).candidate.canonicalHint).toBe("document_reproduction");
  });

  it("learns nothing at a bank whose verdicts point two ways", () => {
    const lessons = lessonsFrom([bankLesson(5, "item fee", "nsf", "overdraft"), bankLesson(5, "item fee", "nsf", "returned_item")]);
    expect(lessons.size).toBe(0);
  });
});

describe("Knox weekly labels", () => {
  const label = (name: string, rightKey: string): KnoxLesson => ({ name, wrongKey: LABEL_WRONG_KEY, rightKey, wrongBanks: 0, rightBanks: 0 });

  it("files a labelled name under the label from whatever category the rules chose", () => {
    const lessons = lessonsFrom([label("zipper bags", "night_deposit")]);
    const applied = applyKnoxLesson(fee("Zipper Bags", "check_printing"), lessons, 12);
    expect(applied.candidate.canonicalHint).toBe("night_deposit");
    expect(applied.lessonFlag).toBe("knox_lesson:check_printing->night_deposit");
    expect(applyKnoxLesson(fee("Zipper Bags", "night_deposit"), lessons).lessonFlag).toBeNull();
  });

  it("ranks the bank's own lesson above a label, and a label above a global lesson", () => {
    const lessons = lessonsFrom([
      lesson("stop payment cancellation", "stop_payment", "account_research"),
      label("stop payment cancellation", "stop_payment"),
    ]);
    expect(applyKnoxLesson(fee("Stop Payment Cancellation", "stop_payment"), lessons).lessonFlag).toBeNull();
    const withBank = lessonsFrom([
      label("statement copy", "document_reproduction"),
      { institutionId: 7, name: "statement copy", wrongKey: "paper_statement", rightKey: "check_image", wrongBanks: 1, rightBanks: 1 },
    ]);
    expect(applyKnoxLesson(fee("Statement Copy", "paper_statement"), withBank, 7).candidate.canonicalHint).toBe("check_image");
    expect(applyKnoxLesson(fee("Statement Copy", "paper_statement"), withBank, 8).candidate.canonicalHint).toBe("document_reproduction");
  });
});

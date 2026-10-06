import { describe, expect, it } from "vitest";
import { applyKnoxLesson, lessonName, lessonsFrom, type KnoxLesson } from "@/lib/agents/knox/lessons";
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

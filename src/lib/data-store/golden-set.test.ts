// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { AnswerKeyBankMember } from "@/lib/agents/deming/golden-set";
import { loadAnswerKeyBankTexts } from "./golden-set";

const bank = (answerKeyId: number, institutionId: number, contentHash: string): AnswerKeyBankMember => ({
  id: `answer_key:${answerKeyId}`, kind: "answer_key_bank", since: 1, answerKeyId, institutionId,
  documentUrl: "https://bank.example/fees.pdf", contentHash, keyFingerprint: "f".repeat(64), receiptEventId: 1,
  receiptCheckedAt: "2026-11-01T12:40:49.119Z", completeInventory: true, expected: { publish: [], forbid: [] },
});

describe("golden answer-key bank texts (read-only)", () => {
  it("maps each bank to the stored text of its exact document hash, and a bank without one to null", async () => {
    const db = vi.fn(async () => [{ institution_id: "395", content_hash: "a".repeat(64), normalized_text: "Fee Schedule\nNSF $30.00" }]);
    const texts = await loadAnswerKeyBankTexts([bank(22, 395, "A".repeat(64)), bank(66, 5410, "b".repeat(64))], db as never);
    expect(texts.get("answer_key:22")).toBe("Fee Schedule\nNSF $30.00");
    expect(texts.get("answer_key:66")).toBeNull();
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("does not query when the set has no banks", async () => {
    const db = vi.fn();
    expect((await loadAnswerKeyBankTexts([], db as never)).size).toBe(0);
    expect(db).not.toHaveBeenCalled();
  });
});

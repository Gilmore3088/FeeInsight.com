import { describe, expect, it } from "vitest";

import { FEE_ERROR_CAUSES, FEE_ERROR_CAUSE_LABELS, citesAnotherAddress, feeErrorStage, isFeeErrorCause, suggestCorrectionCause } from "./fee-error-cause";
import { FEEDBACK_STAGES } from "@/lib/agents/learning/feedback";

const base = { beforeCategory: "overdraft", afterCategory: "overdraft", beforeAmount: 30, afterAmount: 30 };

describe("fee error cause (#2057)", () => {
  it("files each cause against the stage that made the mistake, a stage the feedback store accepts", () => {
    expect(feeErrorStage("wrong_document")).toBe("discover");
    expect(feeErrorStage("text_lost")).toBe("read");
    expect(feeErrorStage("wrong_amount")).toBe("extract");
    expect(feeErrorStage("wrong_category")).toBe("extract");
    expect(feeErrorStage("verify_missed")).toBe("verify");
    expect(feeErrorStage("not_sure")).toBe("publish");
    for (const cause of FEE_ERROR_CAUSES) {
      expect(FEEDBACK_STAGES).toContain(feeErrorStage(cause));
      expect(FEE_ERROR_CAUSE_LABELS[cause].length).toBeGreaterThan(0);
    }
  });

  it("accepts only the listed causes", () => {
    expect(isFeeErrorCause("wrong_document")).toBe(true);
    for (const bad of ["publish", "", null, 3, "Wrong_Document"]) expect(isFeeErrorCause(bad)).toBe(false);
  });

  it("suggests a correction's cause from what it changes, the fee type then the amount, and never a wrong document", () => {
    expect(suggestCorrectionCause({ ...base, afterCategory: "nsf", afterAmount: 25 })).toBe("wrong_category");
    expect(suggestCorrectionCause({ ...base, afterAmount: 25 })).toBe("wrong_amount");
    expect(suggestCorrectionCause({ ...base, beforeAmount: null })).toBe("wrong_amount");
    // A name, frequency or conditions change alone says nothing about the step.
    expect(suggestCorrectionCause(base)).toBe("not_sure");
  });

  it("hints at another page only when the cited document sits at another address", () => {
    expect(citesAnotherAddress("https://bank.example/fees.pdf", "https://other.example/fees.pdf")).toBe(true);
    // A newer copy of the same page is the same document: the fee was read from an old copy.
    expect(citesAnotherAddress("https://bank.example/fees.pdf", "https://www.Bank.example/fees.pdf/#p2")).toBe(false);
    expect(citesAnotherAddress(null, "https://other.example/fees.pdf")).toBe(false);
  });
});

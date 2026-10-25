import { describe, expect, it } from "vitest";

import { FEE_ERROR_CAUSES, FEE_ERROR_CAUSE_LABELS, feeErrorStage, isFeeErrorCause, suggestCorrectionCause } from "./fee-error-cause";
import { FEEDBACK_STAGES } from "@/lib/agents/learning/feedback";

const base = { liveSourceDocumentId: 10, sourceDocumentId: 10, beforeCategory: "overdraft", afterCategory: "overdraft", beforeAmount: 30, afterAmount: 30 };

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

  it("suggests a correction's cause from what it changes: another document, then the fee type, then the amount", () => {
    expect(suggestCorrectionCause({ ...base, sourceDocumentId: 11, afterAmount: 25 })).toBe("wrong_document");
    expect(suggestCorrectionCause({ ...base, afterCategory: "nsf", afterAmount: 25 })).toBe("wrong_category");
    expect(suggestCorrectionCause({ ...base, afterAmount: 25 })).toBe("wrong_amount");
    expect(suggestCorrectionCause({ ...base, beforeAmount: null })).toBe("wrong_amount");
    // A name, frequency or conditions change alone says nothing about the step.
    expect(suggestCorrectionCause(base)).toBe("not_sure");
    // A fee with no known document is never called a wrong document.
    expect(suggestCorrectionCause({ ...base, liveSourceDocumentId: null, sourceDocumentId: 11 })).toBe("not_sure");
  });
});

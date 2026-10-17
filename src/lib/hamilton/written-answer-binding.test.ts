import { describe, expect, it } from "vitest";
import {
  CONTRADICTED_LIMITATION,
  INTERPRETATION_LIMITATION,
  UNSOURCED_FIGURE_LIMITATION,
  supportedText,
} from "./narrative-bound";
import {
  ALL_LEFT_OUT_LEAD,
  PART_LEFT_OUT_LEAD,
  READING_ONLY_LEAD,
  applyNarrativeBinding,
  bindWrittenAnswer,
  bindingLeavesNothing,
  boundFallbackLead,
  readNarrativeBinding,
  withoutOmitted,
  writtenAnswerEvidence,
} from "./written-answer-binding";

// Invented institutions and fees (H06-AC1): Bank A charges $10 for an overdraft, Bank B $35.
const profile = (id: number, name: string, fees: unknown[]) => ({
  identity: { id, name, state: "ZZ" },
  fees: { verified: fees, provisional: [] as unknown[] },
});
const overdraft = (recordId: number, amount: number, extra: Record<string, unknown> = {}) => ({
  fee_name: "Overdraft",
  fee_category: "overdraft",
  amount,
  frequency: "per item",
  status: "verified",
  record_id: recordId,
  source_document_id: recordId + 100,
  ...extra,
});
const BANK_A = profile(9001, "Synthetic Bank A, National Association", [overdraft(1, 10)]);
const BANK_B = profile(9002, "Synthetic Bank B", [overdraft(2, 35)]);
const NATIONAL = { scope: "national", data: [{ category: "overdraft", median: 29, p25: 25, p75: 35 }] };
const TOOLS = [BANK_A, BANK_B, NATIONAL];

const view = (hamiltonView: string, extra: { whatThisMeans?: string; whyItMatters?: string[] } = {}) => ({
  hamiltonView,
  whatThisMeans: extra.whatThisMeans ?? "",
  whyItMatters: extra.whyItMatters ?? [],
});
const bind = (text: string, toolOutputs: unknown[] = TOOLS, question?: string) =>
  bindWrittenAnswer({ sections: view(text), toolOutputs, question });

describe("written answer evidence (#981, H06-T06)", () => {
  it("reads each profile fee as a published record with its row and schedule, and names its bank", () => {
    const found = writtenAnswerEvidence(TOOLS)!;
    expect(found.evidence.facts.map((fact) => [fact.id, fact.scope.institutionId, fact.value, fact.source.sourceDocumentIds])).toEqual([
      ["fee:published:1", 9001, 10, [101]],
      ["fee:published:2", 9002, 35, [102]],
    ]);
    expect(found.evidence.derivations).toEqual([]);
    // The legal suffix goes, so "Synthetic Bank A" in a sentence names the bank.
    expect(found.names.get(9001)).toBe("Synthetic Bank A");
  });

  it("makes no binding when the tools returned no fee record, so the answer shows as before", () => {
    expect(writtenAnswerEvidence([NATIONAL])).toBeNull();
    expect(bind("The national median overdraft fee is $29.", [NATIONAL])).toBeNull();
  });
});

describe("bindWrittenAnswer fixtures", () => {
  it("supported: a bank's own fee keeps the record it rests on", () => {
    const binding = bind("Synthetic Bank A charges $10 for an overdraft.")!;
    expect(binding.supported).toEqual([{ text: "Synthetic Bank A charges $10 for an overdraft.", factIds: ["fee:published:1"] }]);
    expect(binding.interpretation).toEqual([]);
    expect(binding.omitted).toEqual([]);
    expect(binding.limitations).toEqual([]);
  });

  it("interpretation: a benchmark with no record is Hamilton's reading, not a supported fact", () => {
    const binding = bind("Synthetic Bank A charges $10 for an overdraft. The national median is $29.")!;
    expect(supportedText(binding)).toBe("Synthetic Bank A charges $10 for an overdraft.");
    expect(binding.interpretation).toEqual(["The national median is $29."]);
    expect(binding.limitations).toEqual([INTERPRETATION_LIMITATION]);
  });

  it("omitted, wrong bank: another bank's fee stated as this one's is left out (H06-AC1)", () => {
    const binding = bind("Synthetic Bank A charges $35 for an overdraft. Synthetic Bank B charges $35.")!;
    expect(binding.omitted).toEqual([{ text: "Synthetic Bank A charges $35 for an overdraft.", reason: "wrong_institution" }]);
    expect(supportedText(binding)).toBe("Synthetic Bank B charges $35.");
    expect(binding.limitations).toContain(CONTRADICTED_LIMITATION);
  });

  it("gap as fee: the $25 gap stated as Bank A's fee is never a supported fact (H06-AC1)", () => {
    // The profile's fees carry no reporting period, so the contract derives no gap to contradict
    // it: the sentence lands under the label, never as a fact.
    const binding = bind("Synthetic Bank A charges $25 for an overdraft.")!;
    expect(binding.supported).toEqual([]);
    expect(binding.interpretation).toEqual(["Synthetic Bank A charges $25 for an overdraft."]);
  });

  it("wrong year: an undated record never supports a fee stated for a year (H06-AC2)", () => {
    const binding = bind("In 2024 Synthetic Bank A charged $10 for an overdraft.")!;
    expect(binding.supported).toEqual([]);
    expect(binding.interpretation).toEqual(["In 2024 Synthetic Bank A charged $10 for an overdraft."]);
  });

  it("omitted, advice: a line telling the bank what to do with a fee is left out", () => {
    const binding = bind("Synthetic Bank A charges $10 for an overdraft. Synthetic Bank A should raise its overdraft fee to $35.")!;
    expect(binding.omitted).toEqual([{ text: "Synthetic Bank A should raise its overdraft fee to $35.", reason: "advice" }]);
    expect(supportedText(binding)).toBe("Synthetic Bank A charges $10 for an overdraft.");
  });

  it("a fee still in review only supports the labelled reading", () => {
    const pending = profile(9003, "Synthetic Bank C", []);
    pending.fees.provisional = [overdraft(3, 12, { status: "provisional", source_document_id: null })];
    const binding = bind("Synthetic Bank C charges $12 for an overdraft.", [pending])!;
    expect(binding.interpretation).toEqual(["Synthetic Bank C charges $12 for an overdraft."]);
    expect(binding.limitations).toContain(UNSOURCED_FIGURE_LIMITATION);
  });

  it("a figure the reader's own question names may be restated", () => {
    const binding = bind("A $25 overdraft fee would sit below Synthetic Bank B's $35.", TOOLS, "What if we charged $25?")!;
    expect(binding.supported.map((s) => s.text)).toEqual(["A $25 overdraft fee would sit below Synthetic Bank B's $35."]);
  });
});

describe("applying a binding to the answer view", () => {
  const sections = view(
    "Synthetic Bank A charges $10 for an overdraft. Synthetic Bank A charges $35 for an overdraft.\n\nThe national median is $29.",
    { whatThisMeans: "Overdraft draws the most complaints.", whyItMatters: ["Synthetic Bank A should raise its overdraft fee to $35.", "Peers watch this fee."] },
  );
  const binding = bindWrittenAnswer({ sections, toolOutputs: TOOLS })!;

  it("shows supported sentences, keeps the line breaks, and moves the reading under the label", () => {
    const bound = applyNarrativeBinding(sections, binding);
    expect(bound.sections.hamiltonView).toBe("Synthetic Bank A charges $10 for an overdraft.\n");
    expect(bound.sections.whatThisMeans).toBe("Overdraft draws the most complaints.");
    expect(bound.sections.whyItMatters).toEqual(["Peers watch this fee."]);
    expect(bound.reading).toEqual(["The national median is $29."]);
    // The label stands in for the interpretation line; the left-out line stays.
    expect(bound.notes).toEqual([CONTRADICTED_LIMITATION]);
  });

  it("saves the answer without the contradicted sentences, keeping the reading in place", () => {
    const saved = withoutOmitted(sections, binding);
    expect(saved.hamiltonView).toBe("Synthetic Bank A charges $10 for an overdraft.\n\nThe national median is $29.");
    expect(saved.whyItMatters).toEqual(["Peers watch this fee."]);
    // Applying the saved binding again to the saved text shows the same answer.
    expect(applyNarrativeBinding(saved, binding).sections.hamiltonView).toBe(applyNarrativeBinding(sections, binding).sections.hamiltonView);
  });

  it("leaves a legacy answer with no binding exactly as it was", () => {
    expect(applyNarrativeBinding(sections, null)).toEqual({ sections, reading: [], notes: [] });
    expect(withoutOmitted(sections, undefined)).toBe(sections);
  });

  it("opens on a plain line when no supported sentence of the view is left", () => {
    const readingOnly = bind("The national median is $29.")!;
    expect(boundFallbackLead(applyNarrativeBinding(view("The national median is $29."), readingOnly))).toBe(READING_ONLY_LEAD);
    const wrong = view("Synthetic Bank A charges $35 for an overdraft.", { whatThisMeans: "Overdraft draws the most complaints." });
    const wrongBinding = bindWrittenAnswer({ sections: wrong, toolOutputs: TOOLS })!;
    expect(boundFallbackLead(applyNarrativeBinding(wrong, wrongBinding))).toBe(PART_LEFT_OUT_LEAD);
    const allWrong = view("Synthetic Bank A charges $35 for an overdraft.");
    const allWrongBinding = bindWrittenAnswer({ sections: allWrong, toolOutputs: TOOLS })!;
    expect(boundFallbackLead(applyNarrativeBinding(allWrong, allWrongBinding))).toBe(ALL_LEFT_OUT_LEAD);
    expect(bindingLeavesNothing(allWrong, allWrongBinding)).toBe(true);
    expect(bindingLeavesNothing(sections, binding)).toBe(false);
    expect(boundFallbackLead(applyNarrativeBinding(sections, binding))).toBeNull();
  });

  it("reads a saved binding defensively: anything malformed is no binding", () => {
    expect(readNarrativeBinding(JSON.parse(JSON.stringify(binding)))).toEqual(binding);
    expect(readNarrativeBinding(undefined)).toBeNull();
    expect(readNarrativeBinding({ ...binding, version: 2 })).toBeNull();
    expect(readNarrativeBinding({ ...binding, interpretation: [1] })).toBeNull();
    expect(readNarrativeBinding({ ...binding, omitted: [{ text: "x", reason: "made_up" }] })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { INTERPRETATION_LABEL } from "./narrative-bound";
import {
  applyNarrativeBinding,
  bindWrittenAnswer,
  exportedAnswer,
  indexBasisFor,
  readNarrativeBinding,
  writtenAnswerIndexStats,
} from "./written-answer-binding";

// #981 H06-T04: an index median in a written answer stays Hamilton's reading (it is not a fee
// record) but says where it comes from. Invented institutions and index figures.
const BANK_A = {
  identity: { id: 9001, name: "Synthetic Bank A", state: "ZZ" },
  fees: {
    verified: [{ fee_name: "Overdraft", fee_category: "overdraft", amount: 10, frequency: "per item", status: "verified", record_id: 1, source_document_id: 101 }],
    provisional: [],
  },
};
const NATIONAL = { scope: "national", data: [{ category: "overdraft", median: 29, p25: 25, p75: 35, institution_count: 3120 }] };
const TEXAS_BANKS = {
  scope: "filtered",
  filters: { state: "tx", charter: "bank", district: null },
  data: [{ category: "overdraft", median: 32, p25: 30, p75: 35, institution_count: 210 }],
};
const view = (hamiltonView: string) => ({ hamiltonView, whatThisMeans: "", whyItMatters: [] as string[] });

describe("index statistics in a written answer's tools", () => {
  it("reads each median and quartile with its group and count", () => {
    expect(writtenAnswerIndexStats([NATIONAL, TEXAS_BANKS])).toEqual([
      { feeCategory: "overdraft", statistic: "median", value: 29, institutionCount: 3120, scope: "national" },
      { feeCategory: "overdraft", statistic: "p25", value: 25, institutionCount: 3120, scope: "national" },
      { feeCategory: "overdraft", statistic: "p75", value: 35, institutionCount: 3120, scope: "national" },
      { feeCategory: "overdraft", statistic: "median", value: 32, institutionCount: 210, scope: "TX banks" },
      { feeCategory: "overdraft", statistic: "p25", value: 30, institutionCount: 210, scope: "TX banks" },
      { feeCategory: "overdraft", statistic: "p75", value: 35, institutionCount: 210, scope: "TX banks" },
    ]);
  });

  it("skips a row with no institution count, so a figure is never given a basis it lacks", () => {
    expect(writtenAnswerIndexStats([{ scope: "national", data: [{ category: "overdraft", median: 29 }] }])).toEqual([]);
  });
});

describe("the basis line", () => {
  const stats = writtenAnswerIndexStats([NATIONAL, TEXAS_BANKS]);

  it("names the statistic, the group and the count when the sentence states that median", () => {
    expect(indexBasisFor("The national overdraft median is $29.", stats)).toBe(
      "Basis: overdraft median from the national index, 3,120 institutions.",
    );
    expect(indexBasisFor("Texas banks sit at a $32 overdraft median.", stats)).toBe(
      "Basis: overdraft median from the index for TX banks, 210 institutions.",
    );
  });

  it("gives no basis when the sentence does not call the figure a median", () => {
    expect(indexBasisFor("Most banks charge $29 for an overdraft.", stats)).toBeNull();
  });

  it("reads \"middle 50%\" as the quartile band, never as the median", () => {
    expect(indexBasisFor("The middle 50% of overdraft fees runs from $25 to $35.", stats)).toBe(
      "Basis: overdraft 25th percentile from the national index, 3,120 institutions; overdraft 75th percentile from the national index, 3,120 institutions.",
    );
    expect(indexBasisFor("The middle overdraft fee is $29.", stats)).toBeNull();
  });

  it("names a state filter without repeating the word institutions", () => {
    const stateOnly = writtenAnswerIndexStats([{ scope: "filtered", filters: { state: "TX" }, data: [{ category: "overdraft", median: 31, institution_count: 400 }] }]);
    expect(indexBasisFor("The Texas overdraft median is $31.", stateOnly)).toBe("Basis: overdraft median from the index for TX, 400 institutions.");
  });

  it("gives no basis when the sentence names another fee or the amount differs", () => {
    expect(indexBasisFor("The national NSF median is $29.", stats)).toBeNull();
    expect(indexBasisFor("The national overdraft median is $30.", stats)).toBeNull();
  });
});

describe("a written answer with an index median", () => {
  const binding = bindWrittenAnswer({
    sections: view("Synthetic Bank A charges $10 for an overdraft. The national overdraft median is $29."),
    toolOutputs: [BANK_A, NATIONAL],
  })!;

  it("keeps the median under Hamilton's reading and attaches its basis", () => {
    expect(binding.interpretation).toEqual(["The national overdraft median is $29."]);
    expect(binding.readingBasis).toEqual([
      { text: "The national overdraft median is $29.", basis: "Basis: overdraft median from the national index, 3,120 institutions." },
    ]);
    const bound = applyNarrativeBinding(view("Synthetic Bank A charges $10 for an overdraft. The national overdraft median is $29."), binding);
    expect(bound.reading).toEqual(["The national overdraft median is $29."]);
    expect(bound.basis["The national overdraft median is $29."]).toMatch(/^Basis: /);
    expect(INTERPRETATION_LABEL).toBe("Hamilton's reading, not tied to a fee record");
  });

  it("survives a save and reload, and the export prints the same basis", () => {
    const reloaded = readNarrativeBinding(JSON.parse(JSON.stringify(binding)));
    expect(reloaded?.readingBasis).toEqual(binding.readingBasis);
    const exported = exportedAnswer({ ...view("Synthetic Bank A charges $10 for an overdraft. The national overdraft median is $29."), narrativeBinding: binding });
    expect(exported.readingBasis["The national overdraft median is $29."]).toBe("Basis: overdraft median from the national index, 3,120 institutions.");
  });

  it("reads a saved binding with no basis as before", () => {
    const older = { ...binding, readingBasis: undefined };
    expect(readNarrativeBinding(JSON.parse(JSON.stringify(older)))?.readingBasis).toBeUndefined();
  });
});

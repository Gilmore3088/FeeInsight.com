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
    const national = { state: null, charter: null, district: null };
    const texasBanks = { state: "TX", charter: "bank", district: null };
    expect(writtenAnswerIndexStats([NATIONAL, TEXAS_BANKS])).toEqual([
      { feeCategory: "overdraft", statistic: "median", value: 29, institutionCount: 3120, scope: "national", group: national },
      { feeCategory: "overdraft", statistic: "p25", value: 25, institutionCount: 3120, scope: "national", group: national },
      { feeCategory: "overdraft", statistic: "p75", value: 35, institutionCount: 3120, scope: "national", group: national },
      { feeCategory: "overdraft", statistic: "median", value: 32, institutionCount: 210, scope: "TX banks", group: texasBanks },
      { feeCategory: "overdraft", statistic: "p25", value: 30, institutionCount: 210, scope: "TX banks", group: texasBanks },
      { feeCategory: "overdraft", statistic: "p75", value: 35, institutionCount: 210, scope: "TX banks", group: texasBanks },
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

describe("the basis line when two groups share a figure", () => {
  // Invented index figures: the national and Texas medians are both $29.
  const TEXAS = { scope: "filtered", filters: { state: "TX" }, data: [{ category: "overdraft", median: 29, institution_count: 400 }] };
  const NATIONAL_29 = { scope: "national", data: [{ category: "overdraft", median: 29, institution_count: 3120 }] };
  const CALIFORNIA = { scope: "filtered", filters: { state: "CA" }, data: [{ category: "overdraft", median: 29, institution_count: 300 }] };

  it("ties the figure to the group the sentence names, whichever tool came first", () => {
    for (const tools of [[NATIONAL_29, TEXAS], [TEXAS, NATIONAL_29]]) {
      const stats = writtenAnswerIndexStats(tools);
      expect(indexBasisFor("The Texas overdraft median is $29.", stats)).toBe("Basis: overdraft median from the index for TX, 400 institutions.");
      expect(indexBasisFor("The national overdraft median is $29.", stats)).toBe("Basis: overdraft median from the national index, 3,120 institutions.");
    }
  });

  it("gives no basis when the sentence names a group no statistic covers", () => {
    const stats = writtenAnswerIndexStats([NATIONAL_29, TEXAS]);
    expect(indexBasisFor("The California overdraft median is $29.", stats)).toBeNull();
    expect(indexBasisFor("The overdraft median for credit unions is $29.", stats)).toBeNull();
    expect(indexBasisFor("The overdraft median for Texas credit unions is $29.", stats)).toBeNull();
    expect(indexBasisFor("The Texas overdraft median is $29.", writtenAnswerIndexStats([NATIONAL_29]))).toBeNull();
  });

  it("gives no basis when the sentence names no group and the groups that match differ", () => {
    expect(indexBasisFor("The overdraft median is $29.", writtenAnswerIndexStats([TEXAS, CALIFORNIA]))).toBeNull();
  });

  it("reads a sentence that names no group as the national index when one matches", () => {
    const stats = writtenAnswerIndexStats([TEXAS, NATIONAL_29]);
    expect(indexBasisFor("The overdraft median is $29.", stats)).toBe("Basis: overdraft median from the national index, 3,120 institutions.");
  });

  it("does not read \"National\" in a bank's name as the national index", () => {
    const TEXAS_32 = { scope: "filtered", filters: { state: "TX" }, data: [{ category: "overdraft", median: 32, institution_count: 400 }] };
    const nationalOnly = writtenAnswerIndexStats([NATIONAL_29, TEXAS_32]);
    const both = writtenAnswerIndexStats([NATIONAL_29, TEXAS]);
    for (const sentence of [
      "First National Bank charges more than the Texas overdraft median of $29.",
      "National Bank of Commerce sits above the Texas overdraft median of $29.",
      "Citizens National is above the Texas overdraft median of $29.",
    ]) {
      expect(indexBasisFor(sentence, nationalOnly)).toBeNull();
      expect(indexBasisFor(sentence, both)).toBe("Basis: overdraft median from the index for TX, 400 institutions.");
    }
  });

  it("still reads \"national\" outside a bank's name, beside a state or opening the sentence", () => {
    const TEXAS_32 = { scope: "filtered", filters: { state: "TX" }, data: [{ category: "overdraft", median: 32, institution_count: 400 }] };
    const stats = writtenAnswerIndexStats([NATIONAL_29, TEXAS_32]);
    const national = "Basis: overdraft median from the national index, 3,120 institutions.";
    expect(indexBasisFor("First National Bank in Texas is above the national overdraft median of $29.", stats)).toBe(national);
    expect(indexBasisFor("Nationally, the overdraft median is $29, below Texas.", stats)).toBe(national);
    expect(indexBasisFor("National overdraft median: $29, below Texas.", stats)).toBe(national);
  });

  it("reads title-case \"National Median\" and \"U.S. National median\" as the national index (#975)", () => {
    const TEXAS_32 = { scope: "filtered", filters: { state: "TX" }, data: [{ category: "overdraft", median: 32, institution_count: 400 }] };
    const stats = writtenAnswerIndexStats([NATIONAL_29, TEXAS_32]);
    const national = "Basis: overdraft median from the national index, 3,120 institutions.";
    expect(indexBasisFor("Overdraft National Median: $29, below Texas.", stats)).toBe(national);
    expect(indexBasisFor("National Overdraft Median: $29, below Texas.", stats)).toBe(national);
    expect(indexBasisFor("The U.S. National median for overdraft is $29, below Texas.", stats)).toBe(national);
    expect(indexBasisFor("First National Bank sits above the Texas overdraft median of $32.", stats)).toBe(
      "Basis: overdraft median from the index for TX, 400 institutions.",
    );
  });

  it("does not read West Virginia as Virginia", () => {
    const virginia = writtenAnswerIndexStats([{ scope: "filtered", filters: { state: "VA" }, data: [{ category: "overdraft", median: 29, institution_count: 90 }] }]);
    expect(indexBasisFor("The West Virginia overdraft median is $29.", virginia)).toBeNull();
  });
});

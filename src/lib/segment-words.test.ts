import { describe, expect, it } from "vitest";
import { countedGroup, segmentLabel, shortSegmentLabel, theCountedGroup, type SegmentFields } from "./segment-words";

const none: SegmentFields = { minAssets: null, maxAssets: null, charterType: null, stateCode: null, largest: null };
// The question from #2028: "the top 25 of the $1 billion to $10 billion tier", credit unions.
const top25: SegmentFields = { ...none, minAssets: 1_000_000, maxAssets: 10_000_000, charterType: "credit_union", largest: 25 };

describe("countedGroup (#2028)", () => {
  it("puts the count before a plain plural label", () => {
    expect(countedGroup(5, "peers")).toBe("5 peers");
    expect(countedGroup(3, "local competitors")).toBe("3 local competitors");
    expect(countedGroup(6, shortSegmentLabel({ ...none, minAssets: 10_000_000 }))).toBe("6 $10B+ institutions");
    expect(countedGroup(1_204, segmentLabel({ ...none, charterType: "bank", stateCode: "TX" }))).toBe("1,204 banks in Texas");
  });

  it("counts part of a 'the N largest' label as 'n of the N largest', never 'n the N largest'", () => {
    expect(countedGroup(5, shortSegmentLabel(top25))).toBe("5 of the 25 largest $1B to $10B credit unions");
    expect(countedGroup(5, segmentLabel(top25))).toBe(
      "5 of the 25 largest credit unions with $1 billion to $10 billion in assets",
    );
    expect(countedGroup(7, shortSegmentLabel({ ...none, charterType: "bank", stateCode: "TX", largest: 20 }))).toBe(
      "7 of the 20 largest banks in Texas",
    );
  });

  it("reads the whole of a 'the N largest' label as the label itself", () => {
    expect(countedGroup(25, shortSegmentLabel(top25))).toBe("the 25 largest $1B to $10B credit unions");
  });

  it("takes a word for the count", () => {
    expect(countedGroup(1, shortSegmentLabel(top25), "one")).toBe("one of the 25 largest $1B to $10B credit unions");
  });
});

describe("theCountedGroup (#2028)", () => {
  it("adds 'the' before a counted plain plural label", () => {
    expect(theCountedGroup(3, "local competitors")).toBe("the 3 local competitors");
    expect(theCountedGroup(184, shortSegmentLabel({ ...none, minAssets: 10_000_000 }))).toBe("the 184 $10B+ institutions");
  });

  it("never stacks 'the N' onto a label that already starts with 'the N largest'", () => {
    expect(theCountedGroup(5, shortSegmentLabel(top25))).toBe("the 5 of the 25 largest $1B to $10B credit unions");
    expect(theCountedGroup(25, shortSegmentLabel(top25))).toBe("the 25 largest $1B to $10B credit unions");
    expect(theCountedGroup(25, segmentLabel(top25))).toBe("the 25 largest credit unions with $1 billion to $10 billion in assets");
  });
});

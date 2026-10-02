import { describe, expect, it } from "vitest";
import { NUMERIC_AS_NUMBER } from "./connection";

describe("NUMERIC_AS_NUMBER", () => {
  it("parses postgres NUMERIC (oid 1700) text into numbers", () => {
    expect(NUMERIC_AS_NUMBER.from).toEqual([1700]);
    expect(NUMERIC_AS_NUMBER.parse("35.00")).toBe(35);
    expect(NUMERIC_AS_NUMBER.parse("0.50")).toBe(0.5);
  });

  it("serializes numbers back to text for parameters", () => {
    expect(NUMERIC_AS_NUMBER.serialize(12.5)).toBe("12.5");
  });
});

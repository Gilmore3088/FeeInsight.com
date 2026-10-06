import { describe, expect, it } from "vitest";
import { ApiParamError, csvField, districtParam, intParam, stateParam, toCsv } from "./api-v1";

const params = (query: string) => new URLSearchParams(query);

describe("api-v1 params", () => {
  it("validates whole-number ranges", () => {
    expect(intParam(params(""), "page", { fallback: 1, min: 1, max: 10 })).toBe(1);
    expect(intParam(params("page=3"), "page", { fallback: 1, min: 1, max: 10 })).toBe(3);
    expect(() => intParam(params("page=0"), "page", { fallback: 1, min: 1, max: 10 })).toThrow(ApiParamError);
    expect(() => intParam(params("page=abc"), "page", { fallback: 1, min: 1, max: 10 })).toThrow(ApiParamError);
    expect(() => intParam(params("page=-2"), "page", { fallback: 1, min: 1, max: 10 })).toThrow(ApiParamError);
  });

  it("upper-cases two-letter states and rejects anything else", () => {
    expect(stateParam(params("state=tx"))).toBe("TX");
    expect(stateParam(params(""))).toBeNull();
    expect(() => stateParam(params("state=Texas"))).toThrow(ApiParamError);
  });

  it("parses Fed districts 1-12", () => {
    expect(districtParam(params("district=2,7,7"))).toEqual([2, 7]);
    expect(() => districtParam(params("district=13"))).toThrow(ApiParamError);
    expect(() => districtParam(params("district=a"))).toThrow(ApiParamError);
  });
});

describe("api-v1 CSV", () => {
  it("quotes commas and quotes and defuses spreadsheet formulas", () => {
    expect(csvField('ATM "foreign" fee, per use')).toBe('"ATM ""foreign"" fee, per use"');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField(-5)).toBe("-5");
    expect(csvField(null)).toBe("");
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\n1,"x,y"');
  });
});

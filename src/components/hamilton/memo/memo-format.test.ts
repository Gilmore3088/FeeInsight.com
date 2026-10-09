import { describe, expect, it } from "vitest";
import { fmtMoney } from "./memo";

describe("fmtMoney", () => {
  it("groups thousands and keeps cents only when there are any", () => {
    expect(fmtMoney(32)).toBe("$32");
    expect(fmtMoney(29.5)).toBe("$29.50");
    expect(fmtMoney(209_400)).toBe("$209,400");
    expect(fmtMoney(1250.5)).toBe("$1,250.50");
    expect(fmtMoney(null)).toBe("Not published");
  });
});

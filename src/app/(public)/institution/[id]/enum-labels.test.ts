import { describe, expect, it } from "vitest";
import { holdingCompanyName, placeName } from "./enum-labels";

describe("readable registry names (#1953)", () => {
  it("prints holding companies as the companies do", () => {
    expect(holdingCompanyName("U S BCORP")).toBe("U.S. Bancorp");
    expect(holdingCompanyName("WAFD INC")).toBe("WaFd Inc.");
    expect(holdingCompanyName("CAPITAL CITY BANK GROUP INC")).toBe("Capital City Bank Group Inc.");
    expect(holdingCompanyName(null)).toBeNull();
  });

  it("capitalises every word of a place name except small words", () => {
    expect(placeName("Fort lauderdale")).toBe("Fort Lauderdale");
    expect(placeName("FORT LAUDERDALE")).toBe("Fort Lauderdale");
    expect(placeName("Ponte Vedra Beach")).toBe("Ponte Vedra Beach");
    expect(placeName("Isle of Palms")).toBe("Isle of Palms");
  });
});

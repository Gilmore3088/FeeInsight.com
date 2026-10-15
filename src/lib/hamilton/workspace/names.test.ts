import { describe, expect, it } from "vitest";
import { directionalTitle, proseFeeName } from "./names";

describe("proseFeeName", () => {
  it("keeps a wire's direction, which the bracket used to carry", () => {
    expect(proseFeeName("wire_domestic_outgoing")).toBe("outgoing domestic wire");
    expect(proseFeeName("wire_domestic_incoming")).toBe("incoming domestic wire");
    expect(proseFeeName("wire_intl_outgoing")).toBe("outgoing international wire");
  });
  it("still drops an abbreviation in brackets", () => {
    expect(proseFeeName("overdraft")).toBe("overdraft");
    expect(proseFeeName("atm_non_network")).toBe("non-network ATM");
  });
});

describe("directionalTitle", () => {
  it("titles a wire with its direction and leaves other fees to the usual name", () => {
    expect(directionalTitle("wire_domestic_outgoing")).toBe("Outgoing Domestic Wire");
    expect(directionalTitle("overdraft")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { layoutSignature, thinLayouts } from "@/lib/agents/knox/layout-signature";

describe("Knox layout signatures", () => {
  it("names how a text's prices sit", () => {
    expect(layoutSignature("Wire Transfer | $25.00\nStop Payment | $30.00").signature).toBe("table/short");
    expect(layoutSignature("Stop Payment ........ $30.00\nWire Out ....... $25.00").signature).toBe("leaders/short");
    expect(layoutSignature("We will charge a fee of $30 for each overdraft.\nA fee of $5 is charged.").signature).toBe("sentences/short");
    expect(layoutSignature("Stop Payment\n$30.00\nWire Out\n$25.00 each").signature).toBe("split/short");
    expect(layoutSignature("Welcome to our bank").signature).toBe("no_prices");
  });

  it("marks a PDF flattened to long lines", () => {
    const long = `Schedule of fees ${"Stop Payment $30.00 Wire Transfer $25.00 ".repeat(12)}`;
    expect(layoutSignature(long).signature).toBe("plain/long");
  });

  it("groups thin reads by signature", () => {
    const groups = thinLayouts([
      { signature: "split/short", priceLines: 20, found: 1 },
      { signature: "split/short", priceLines: 12, found: 0 },
      { signature: "table/short", priceLines: 30, found: 28 },
      { signature: "table/short", priceLines: 2, found: 1 },
      { signature: "no_prices", priceLines: 0, found: 0 },
    ]);
    expect(Object.keys(groups)[0]).toBe("split/short");
    expect(groups["split/short"]).toEqual({ documents: 2, thin: 2 });
    expect(groups["table/short"]).toEqual({ documents: 2, thin: 0 });
    expect(groups.no_prices).toBeUndefined();
  });
});

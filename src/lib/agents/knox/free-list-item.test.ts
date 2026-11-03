import { describe, expect, it } from "vitest";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "@/lib/agents/knox/specialists";

/**
 * v169 (#1092, James's Nov 2 review): Mountain Star FCU (4467, document 38274), text 36365 as
 * read.pdf_layout stored it before Rosetta's layout v6. "Fax Service" is one of the "Other Free
 * Services"; the $5.00 under its line is the left column's money market excess check price.
 */
const MOUNTAIN_STAR_36365 = [
  "Copies | *Inactive",
  "$10.00",
  "account fee",
  "Mailed paper | $1.00",
  "statement | Instant Issue | Other Free Services: Anytime, Notary",
  "$10.00 | Service, Signature Guarantee, Unlimited",
  "Debit Card",
  "Membership Fee $3.00 | Check Writing, Balance Inquiries,",
  "Money market | Fax Service",
  "$5.00",
  "excess check",
  "Money Orders $.75 ea.",
  "NSF Check $30.00",
].join("\n");

const reads = (text: string) => runFreeSpecialists(text).candidates.map((fee) => [fee.feeName, fee.amount]);

describe("Knox v169: a free services list item never takes another line's price", () => {
  it("is rules v169 or later", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(169);
  });

  it("holds Fax Service $5 untraced and keeps the fees priced on their own lines", () => {
    const result = runFreeSpecialists(MOUNTAIN_STAR_36365);
    expect(reads(MOUNTAIN_STAR_36365)).not.toContainEqual(["Fax Service", 5]);
    expect(result.held).toContainEqual(expect.objectContaining({ shape: "untraced", feeName: "Fax Service", amount: 5 }));
    expect(result.dropped.free_list_item).toBeGreaterThan(0);
    // The same stacked layout with no list: the inactive account fee keeps its price.
    expect(reads(MOUNTAIN_STAR_36365)).toContainEqual(["Inactive", 10]);
    expect(reads(MOUNTAIN_STAR_36365)).toContainEqual(["Money Orders", 0.75]);
    expect(reads(MOUNTAIN_STAR_36365)).toContainEqual(["NSF Check", 30]);
  });

  it("never gives a name the price below another label's line", () => {
    expect(reads(["Fax Service", "Notary", "$5.00"].join("\n"))).not.toContainEqual(["Fax Service", 5]);
  });

  it("never gives a name on a line that says free a price from the line below", () => {
    expect(reads(["Fax Service FREE", "$5.00"].join("\n"))).not.toContainEqual(["Fax Service", 5]);
  });

  it("reads a fee priced on its own line in a free list's column", () => {
    const text = ["Account Fees | Other Free Services: Notary, Coin counting", "Stop Payment $20.00 | Signature Guarantee"].join("\n");
    expect(reads(text)).toContainEqual(["Stop Payment", 20]);
  });
});

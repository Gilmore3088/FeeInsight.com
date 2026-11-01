import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AmountEvidence, EvidenceRecord } from "@/lib/custom-report/evidence";
import { Evidence } from "./fee-comparison";

const record = (amount: number, product: string, exception = false): EvidenceRecord => ({
  record_id: amount * 100,
  product,
  amount,
  quote: `${product} $${amount.toFixed(2)}`,
  source_url: null,
  read_on: null,
  problem: null,
  ...(exception ? { account_product: "Safe Debit Account", product_exception: true } : {}),
});

describe("the report's evidence beside a named account's exception (#1911)", () => {
  it("states the compared price over the general line only and lists the exception apart", () => {
    const evidence = {
      amount: 3,
      basis: "published price",
      records: [record(2.5, "Non-U.S. Bank ATM transaction", true), record(3, "Non-U.S. Bank ATM transaction")],
      excluded: [],
    } as unknown as AmountEvidence;
    const text = render(<Evidence evidence={evidence} />).container.textContent ?? "";
    expect(text).not.toContain("Each of these lines states");
    expect(text).toContain("Priced for Safe Debit Account only; not compared");
    expect(text.indexOf("$3.00")).toBeLessThan(text.indexOf("Priced for"));
  });

  it("keeps the basis sentence when every line is compared", () => {
    const evidence = { amount: 3, basis: "published price", records: [record(3, "ATM"), record(3, "ATM fee")], excluded: [] } as unknown as AmountEvidence;
    const text = render(<Evidence evidence={evidence} />).container.textContent ?? "";
    expect(text).toContain("Each of these lines states $3:");
    expect(text).not.toContain("Priced for");
  });
});

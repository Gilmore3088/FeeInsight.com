import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Ledger } from "@/lib/hamilton/workspace/decisions";
import type { DecisionRecord } from "@/lib/hamilton/workspace/types";
import { DecisionLedger } from "./DecisionLedger";

const byStatus = { researching: 0, modeling: 1, decided: 1, implementing: 0, monitoring: 0, closed: 0 };

function decision(id: string, title: string): DecisionRecord {
  return {
    id,
    institutionId: 1,
    feeCategory: "overdraft",
    title,
    status: "decided",
    chosenAmount: 30,
    chosenBy: "Pat",
    watchConditions: [{ kind: "competitor_change", feeCategory: "overdraft", label: "A competitor in your state changes its overdraft fee" }],
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
  };
}

describe("DecisionLedger", () => {
  it("says plainly when there are no decisions", () => {
    const ledger: Ledger = { decisions: 0, byStatus: { ...byStatus, modeling: 0, decided: 0 }, chosen: 0, dollars: { low: 0, high: 0, decisions: 0 }, lines: [] };
    expect(renderToStaticMarkup(<DecisionLedger ledger={ledger} decisions={[]} institutionId="1" />)).toContain("No decisions yet");
  });

  it("shows dollars only from the bank's own figures, and what each decision watches", () => {
    const ledger: Ledger = {
      decisions: 2,
      byStatus,
      chosen: 1,
      dollars: { low: 0, high: 0, decisions: 0 },
      lines: [
        { decisionId: "d1", title: "Overdraft price", feeCategory: "overdraft", status: "decided", chosenAmount: 30, annualEffect: null, evidenceLevel: "market" },
        { decisionId: "d2", title: "NSF price", feeCategory: "nsf", status: "modeling", chosenAmount: null, annualEffect: null, evidenceLevel: null },
      ],
    };
    const html = renderToStaticMarkup(<DecisionLedger ledger={ledger} decisions={[decision("d1", "Overdraft price")]} institutionId="1" />);
    expect(html).toContain("Not yet known");
    expect(html).toContain("/pro/settings?instId=1#your-figures");
    expect(html).toContain("Watching: A competitor in your state changes its overdraft fee");
    expect(html).toContain("Needs your figures");
    expect(html).toContain("Not chosen");
    expect(html).toContain("Comparing prices");
    expect(html).not.toMatch(/recommend/i);
    // Both decisions are on a fee, so both can go into a deliverable.
    expect(html).toContain('action="/pro/monitor/deliverable"');
    expect(html.match(/name="ids"/g)).toHaveLength(2);
    expect(html).toContain("Pricing committee packet");
  });

  it("sums the effect when it rests on institution evidence", () => {
    const ledger: Ledger = {
      decisions: 1,
      byStatus: { ...byStatus, modeling: 0 },
      chosen: 1,
      dollars: { low: 12000, high: 18000, decisions: 1 },
      lines: [{ decisionId: "d1", title: "Overdraft price", feeCategory: "overdraft", status: "decided", chosenAmount: 30, annualEffect: { low: 12000, high: 18000 }, evidenceLevel: "institution" }],
    };
    const html = renderToStaticMarkup(<DecisionLedger ledger={ledger} decisions={[]} institutionId="1" />);
    expect(html).toContain("+$12,000 to +$18,000");
    expect(html).toContain("over 1 decision");
    expect(html).toContain("Your own figures");
  });
});

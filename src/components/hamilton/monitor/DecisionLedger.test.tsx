import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Ledger } from "@/lib/hamilton/workspace/decisions";
import { DecisionLedger } from "./DecisionLedger";

const byStatus = { researching: 0, modeling: 1, decided: 0, implementing: 0, monitoring: 0, closed: 1 };

describe("DecisionLedger", () => {
  it("says plainly when there are no decisions", () => {
    const ledger: Ledger = { decisions: 0, byStatus: { ...byStatus, modeling: 0, closed: 0 }, lines: [] };
    expect(renderToStaticMarkup(<DecisionLedger ledger={ledger} institutionId="1" />)).toContain("No decisions yet");
  });

  it("lists each decision and where it stands, and turns them into a deliverable", () => {
    const ledger: Ledger = {
      decisions: 2,
      byStatus,
      lines: [
        { decisionId: "d1", title: "Overdraft price", feeCategory: "overdraft", status: "closed" },
        { decisionId: "d2", title: "NSF price", feeCategory: "nsf", status: "modeling" },
      ],
    };
    const html = renderToStaticMarkup(<DecisionLedger ledger={ledger} institutionId="1" />);
    expect(html).toContain("Comparing prices");
    expect(html).toContain("2 in all");
    // Choosing an option was never reachable (#1083): nothing about a chosen price or what is watched.
    expect(html).not.toMatch(/Price chosen|Not chosen|Watching:|Fee income a year/);
    expect(html).not.toMatch(/recommend/i);
    expect(html).toContain('action="/pro/monitor/deliverable"');
    expect(html.match(/name="ids"/g)).toHaveLength(2);
    expect(html).toContain("Pricing committee packet");
    expect(html).not.toContain("Implementation checklist");
  });
});

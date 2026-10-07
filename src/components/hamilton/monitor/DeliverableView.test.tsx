import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Deliverable } from "@/lib/hamilton/workspace/deliverables";
import { DeliverableView } from "./DeliverableView";

const source = { label: "Bank Fee Index, published fees", table: "published_fee_catalog", asOf: "2026-10-01" };

describe("DeliverableView", () => {
  it("renders paragraphs, sourced lines, tables, checklists and the appendix", () => {
    const deliverable: Deliverable = {
      kind: "implementation_checklist",
      title: "Implementation checklist",
      institutionName: "Example Bank",
      preparedOn: "2026-10-06T00:00:00Z",
      decisionIds: ["d1"],
      sections: [
        {
          heading: "Where the overdraft fee sits",
          paragraphs: ["Example Bank charges $30."],
          facts: [{ text: "The peer median is $29.", source, sampleSize: 41 }],
          table: { columns: ["Price", "Peers charging less"], rows: [["$30", "22 of 41"]] },
          checklist: [{ text: "Send the change-in-terms notice", rule: "Reg DD, 30 days before" }],
        },
      ],
      appendix: [
        {
          decisionTitle: "Overdraft price",
          provenance: {
            engineVersion: "1.4.0",
            generatedAt: "2026-10-06T00:00:00Z",
            evidenceLevel: "market",
            peerGroup: { label: "Texas banks", n: 41 },
            dataAsOf: { fees: "2026-10-01" },
            sources: [source],
            assumptions: ["Items a year are a market assumption."],
            clientFacts: [],
          },
        },
      ],
    };
    const html = renderToStaticMarkup(<DeliverableView deliverable={deliverable} />);
    for (const text of [
      "Where the overdraft fee sits",
      "Example Bank charges $30.",
      "The peer median is $29.",
      "22 of 41",
      "Send the change-in-terms notice",
      "Reg DD, 30 days before",
      "How these figures were built",
      "Market data only",
      "Texas banks, n=41",
      "October 1, 2026",
      "Items a year are a market assumption.",
    ]) {
      expect(html).toContain(text);
    }
  });
});

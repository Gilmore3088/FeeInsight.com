import { describe, expect, it } from "vitest";
import { buildLedger } from "./decisions";
import type { DecisionRecord } from "./types";

const decision = (id: string, status: DecisionRecord["status"]): DecisionRecord => ({
  id,
  institutionId: 1,
  feeCategory: "overdraft",
  title: "Overdraft fee",
  status,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});

describe("the ledger", () => {
  it("counts decisions by where each stands, one line per decision", () => {
    const ledger = buildLedger([decision("a", "researching"), decision("b", "modeling"), decision("c", "closed")]);
    expect(ledger).toMatchObject({ decisions: 3 });
    expect(ledger.byStatus).toMatchObject({ researching: 1, modeling: 1, closed: 1, decided: 0 });
    expect(ledger.lines.map((l) => l.decisionId)).toEqual(["a", "b", "c"]);
  });
});

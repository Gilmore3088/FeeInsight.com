import { describe, expect, it, vi } from "vitest";

import {
  heldExcerpt,
  heldRecheckFlag,
  promotedConditions,
  recategorizeHeld,
  recheckHeldRows,
} from "./held-recheck";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const conditions = (excerpt: string) =>
  `Knox held for review (unclassified) from Rosetta artifact #704. canonical_hint=none; text_hash=abc; excerpt="${excerpt}"`;

// Production rows an older rules version held (raw 118567, 109417, 109151).
const courtesyPay = { fee_raw_id: 118567, amount: "30.00", conditions: conditions("Courtesy Pay Fee | $30") };
const inactivity = {
  fee_raw_id: 109417,
  amount: "5.00",
  conditions: conditions("Inactivity fee ...................$5.00 per month"),
};
const returnedMail = { fee_raw_id: 109151, amount: "5.00", conditions: conditions("Returned Mail Fee | $5.00/month") };

type Db = Parameters<typeof recheckHeldRows>[0];

function createDb(rows: unknown[]) {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("SELECT fr.fee_raw_id")) return Promise.resolve(rows);
    if (text.includes("RETURNING fr.fee_raw_id")) return Promise.resolve([{ fee_raw_id: 1 }]);
    return Promise.resolve([]);
  });
  return db;
}

describe("Knox held-line re-check", () => {
  it("reads the excerpt Knox stored with a held row", () => {
    expect(heldExcerpt(courtesyPay.conditions)).toBe("Courtesy Pay Fee | $30");
    expect(heldExcerpt("no excerpt here")).toBeNull();
  });

  it("categorizes held lines today's rules know, at the same amount", () => {
    expect(recategorizeHeld(courtesyPay)?.canonicalHint).toBe("overdraft");
    expect(recategorizeHeld(inactivity)?.canonicalHint).toBe("dormant_account");
    expect(recategorizeHeld(returnedMail)).toBeNull();
    expect(recategorizeHeld({ ...courtesyPay, amount: "35.00" })).toBeNull();
  });

  it("rewrites the audit text with the category", () => {
    const candidate = recategorizeHeld(courtesyPay)!;
    const text = promotedConditions(courtesyPay.conditions, candidate);
    expect(text).toMatch(/^Knox extract\.rules v\d+ categorized a line held for review from Rosetta artifact #704/);
    expect(text).toContain("canonical_hint=overdraft;");
    expect(text).toContain("text_hash=abc;");
  });

  it("sends categorized lines to Darwin and marks the rest with the rules version", async () => {
    const db = createDb([courtesyPay, inactivity, returnedMail]);
    const result = await recheckHeldRows(db as unknown as Db, { stateCode: "tx" });
    expect(result).toEqual({
      checked: 3,
      promoted: 2,
      stillHeld: 1,
      promotedByCategory: { overdraft: 1, dormant_account: 1 },
      dryRun: false,
    });
    const select = templateText(db.mock.calls[0][0]);
    expect(select).toContain("knox_review:unclassified");
    expect(select).toContain("FROM agent_source_texts adt");
    expect(db.mock.calls[0]).toContain("TX");
    const updates = db.mock.calls.slice(1).map((call) => JSON.stringify(call));
    expect(updates[0]).toContain("needs_darwin_verification");
    expect(updates[0]).toContain("canonical_hint:overdraft");
    expect(updates[0]).toContain("knox_promoted_from_held");
    expect(updates[2]).toContain(heldRecheckFlag());
    expect(updates[2]).toContain("109151");
  });

  it("writes nothing on a dry run", async () => {
    const db = createDb([courtesyPay, returnedMail]);
    const result = await recheckHeldRows(db as unknown as Db, { dryRun: true });
    expect(result).toMatchObject({ checked: 2, promoted: 1, stillHeld: 1, dryRun: true });
    expect(db).toHaveBeenCalledTimes(1);
  });
});

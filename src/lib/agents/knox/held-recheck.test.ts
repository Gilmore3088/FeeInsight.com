import { describe, expect, it, vi } from "vitest";

import {
  HELD_SET_ASIDE_FLAG,
  heldExcerpt,
  heldRecheckFlag,
  promotedConditions,
  recategorizeHeld,
  recheckHeldRows,
  versionsChecked,
} from "./held-recheck";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const conditions = (excerpt: string) =>
  `Knox held for review (unclassified) from Rosetta artifact #704. canonical_hint=none; text_hash=abc; excerpt="${excerpt}"`;

// Production rows an older rules version held (raw 118567, 109417, 109151). A membership
// fee has no category, so it stays held; this one was already read by two versions.
const courtesyPay = { fee_raw_id: 118567, amount: "30.00", conditions: conditions("Courtesy Pay Fee | $30") };
const inactivity = {
  fee_raw_id: 109417,
  amount: "5.00",
  conditions: conditions("Inactivity fee ...................$5.00 per month"),
};
const returnedMail = { fee_raw_id: 109151, amount: "5.00", conditions: conditions("Returned Mail Fee | $5.00/month") };
const membership = {
  fee_raw_id: 109152,
  amount: "5.00",
  fee_name: "Membership Fee",
  conditions: conditions("Membership Fee | $5.00"),
  outlier_flags: ["knox_review:unclassified", "knox_recheck:extract.rules:v20", "knox_recheck:extract.rules:v24"],
};

type Db = Parameters<typeof recheckHeldRows>[0];

function createDb(rows: unknown[]) {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("SELECT fr.fee_raw_id")) return Promise.resolve(rows);
    if (text.includes("RETURNING fr.fee_raw_id")) return Promise.resolve([{ fee_raw_id: 1 }]);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("INSERT INTO pipeline_feedback")) return Promise.resolve([{ id: 1 }]);
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
    // v25 folds returned mail into account research (James, Oct 7 2026).
    expect(recategorizeHeld(returnedMail)?.canonicalHint).toBe("account_research");
    expect(recategorizeHeld(membership)).toBeNull();
    expect(recategorizeHeld({ ...courtesyPay, amount: "35.00" })).toBeNull();
  });

  it("rewrites the audit text with the category", () => {
    const candidate = recategorizeHeld(courtesyPay)!;
    const text = promotedConditions(courtesyPay.conditions, candidate);
    expect(text).toMatch(/^Knox extract\.rules v\d+ categorized a line held for review from Rosetta artifact #704/);
    expect(text).toContain("canonical_hint=overdraft;");
    expect(text).toContain("text_hash=abc;");
  });

  it("counts the rules versions that have read a held line", () => {
    expect(versionsChecked(membership, 25)).toEqual([20, 24, 25]);
    expect(versionsChecked(courtesyPay, 25)).toEqual([25]);
  });

  it("sends categorized lines to Darwin, sets aside lines read by three versions, and logs every decision", async () => {
    const db = createDb([courtesyPay, inactivity, membership]);
    const result = await recheckHeldRows(db as unknown as Db, { stateCode: "tx", runId: 7 });
    expect(result).toEqual({
      checked: 3,
      promoted: 2,
      stillHeld: 1,
      setAside: 1,
      logged: 1,
      promotedByCategory: { overdraft: 1, dormant_account: 1 },
      dryRun: false,
    });
    const select = templateText(db.mock.calls[0][0]);
    expect(select).toContain("knox_review:unclassified");
    expect(select).toContain("FROM agent_source_texts adt");
    expect(db.mock.calls[0]).toContain("TX");
    const calls = db.mock.calls.map((call) => ({ text: templateText(call[0]), json: JSON.stringify(call) }));
    const promotions = calls.filter((call) => call.text.includes("RETURNING fr.fee_raw_id"));
    expect(promotions[0].json).toContain("canonical_hint:overdraft");
    expect(promotions[0].json).toContain("knox_promoted_from_held");
    const updates = calls.filter((call) => call.text.includes("UPDATE raw_fee_observations"));
    const marked = updates.find((call) => call.json.includes(heldRecheckFlag()));
    expect(marked?.json).toContain("109152");
    const setAside = updates.find((call) => call.json.includes(HELD_SET_ASIDE_FLAG));
    expect(setAside?.json).toContain("109152");
    // Nothing is deleted.
    expect(calls.some((call) => /\bDELETE\b/i.test(call.text))).toBe(false);
    const log = calls.find((call) => call.text.includes("INSERT INTO pipeline_feedback"));
    expect(log?.json).toContain("knox.held:raw:118567");
    expect(log?.json).toContain("promoted_from_held");
    expect(log?.json).toContain("set_aside_no_category");
    expect(log?.json).toContain("[20,24,");
  });

  it("writes nothing on a dry run", async () => {
    const db = createDb([courtesyPay, membership]);
    const result = await recheckHeldRows(db as unknown as Db, { dryRun: true });
    expect(result).toMatchObject({ checked: 2, promoted: 1, stillHeld: 1, setAside: 1, logged: 0, dryRun: true });
    expect(db).toHaveBeenCalledTimes(1);
  });
});

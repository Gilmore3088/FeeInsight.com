import { describe, expect, it, vi } from "vitest";

import { COMPANION_RETIRE_REASON, rollBackRetiredCompanionFees } from "./companion-retire";

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function createDb(rows: Array<Record<string, unknown>>): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("AS companion_ready")) return Promise.resolve([{ companion_ready: true }]);
    if (text.includes("FROM institution_additional_sources ias")) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
}

const asDb = (db: DbMock) => db as unknown as Parameters<typeof rollBackRetiredCompanionFees>[0];

const helocLive = {
  fee_published_id: 60403,
  fee_verified_id: 880,
  institution_id: 8455,
  canonical_fee_key: "early_closure",
  fee_name: "Early closure",
  amount: "1214.50",
  companion_source_id: 67,
  url: "https://frontier.example/documents/heloc-important-terms-disclosures/",
};
const helocPending = { ...helocLive, fee_published_id: null, fee_verified_id: 881 };

describe("Hamilton companion retire", () => {
  it("rolls back live fees and rejects verified fees from pages retired as not a consumer fee page", async () => {
    const db = createDb([helocLive, helocPending]);

    const result = await rollBackRetiredCompanionFees(asDb(db), { runId: 300, batchId: "agentic-run-300", dryRun: false, stateCode: "WA" });

    expect(result.rejectedVerified).toBe(2);
    expect(result.rollbacks).toEqual([
      {
        feePublishedId: 60403,
        institutionId: 8455,
        canonicalFeeKey: "early_closure",
        feeName: "Early closure",
        amount: 1214.5,
        companionSourceId: 67,
        url: helocLive.url,
      },
    ]);
    const select = db.mock.calls.find((call) => templateText(call[0]).includes("FROM institution_additional_sources ias"));
    expect(templateText(select?.[0])).toContain("ias.status = 'rejected'");
    expect(select).toContain("not_consumer_fee_page%");
    const rollback = db.mock.calls.find((call) => templateText(call[0]).includes("UPDATE published_fee_records"));
    expect(rollback).toContain(COMPANION_RETIRE_REASON);
    expect(rollback).toContainEqual([60403]);
    const reject = db.mock.calls.find((call) => templateText(call[0]).includes("UPDATE verified_fee_observations"));
    expect(reject).toContainEqual([880, 881]);
    expect(JSON.stringify(db.mock.calls)).toContain("hamilton.companion_fees_rolled_back");
  });

  it("only reads in a dry run", async () => {
    const db = createDb([helocLive]);
    const result = await rollBackRetiredCompanionFees(asDb(db), { runId: 301, batchId: "agentic-run-301", dryRun: true });
    expect(result.rollbacks).toHaveLength(1);
    expect(db.mock.calls.some((call) => templateText(call[0]).includes("UPDATE"))).toBe(false);
    expect(db.mock.calls.some((call) => templateText(call[0]).includes("INSERT"))).toBe(false);
  });

  it("never blocks publishing when the sweep fails", async () => {
    const db = vi.fn(() => Promise.reject(new Error("boom")));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await rollBackRetiredCompanionFees(asDb(db), { runId: 302, batchId: "agentic-run-302", dryRun: false });
    expect(result).toEqual({ rollbacks: [], rejectedVerified: 0 });
    errors.mockRestore();
  });
});

import { describe, expect, it, vi } from "vitest";
vi.mock("./connection", () => ({ sql: vi.fn() }));
import { getConfirmedAnswerKey, getLatestAnswerKeyScoreRun } from "./answer-key";
import { referenceSnapshot, referenceScoreCohort, sameReferenceCohort } from "./answer-key-reference-store";
import { CONSUMER_TEXT, fixtureEligibility, fixtureEvent, fixtureReceipt, fixtureReference, REFERENCE_NOW } from "./__fixtures__/answer-key-reference";

const noDb = vi.fn(() => { throw new Error("Operation must reuse its supplied reference snapshot"); }) as unknown as Parameters<typeof getConfirmedAnswerKey>[0];
describe("answer-key document eligibility before scoring (#1862)", () => {
  // Synthetic reproductions of #629 comment6246011208/#1862; no fresh bank check or key correction.
  it.each([
    [114, "iTHINK business schedule", "Personal\nBusiness Fee Schedule\nOverdraft fee $25\nStop payment fee $20\nWire transfer fee $15", "/business-fees.pdf", "business_document"],
    [6, "Texas Capital closed legacy accounts", `${CONSUMER_TEXT}\nAccount types previously offered and no longer available to open as of May3,2023.`, "/previously-offered-products", "legacy_not_current"],
    [83, "TDECU unpriced rates hub", "Personal Rates\nSavings APY4.00%\nChecking APY1.00%\nOpening balance $1000", "/rates", "not_priced_schedule"],
  ] as const)("records/excludes key%i: %s", async (id, _name, text, path, reason) => {
    const fixture = fixtureReference(text, path, id);
    const snapshot = fixtureEligibility(fixture);
    expect(snapshot.keys[0].receipt?.reasons).toContain(reason);
    expect(snapshot.cohort).toMatchObject({ state: "no_measurement", eligibleBanks: 0, excludedBanks: 1, excludedFees: 1 });
    expect(await getConfirmedAnswerKey(noDb, snapshot)).toEqual([]);
  });

  it("passes a current byte-bound consumer reference without modifying its confirmation or fees", async () => {
    const fixture = fixtureReference();
    const before = structuredClone(fixture.input.key);
    expect(await getConfirmedAnswerKey(noDb, fixtureEligibility(fixture))).toMatchObject([{
      institutionId: 999, fees: [{ canonicalKey: "overdraft", amount: 25, amountKind: "fixed" }],
    }]);
    expect(fixture.input.key).toEqual(before);
  });

  it.each(["unknown", "malformed", "wrong protocol"])("uses the newest %s tombstone, never an older pass", (failure) => {
    const fixture = fixtureReference();
    const passed = fixtureEvent(fixtureReceipt(fixture));
    const latest = fixtureEvent(fixtureReceipt(fixture), 2);
    if (failure === "unknown") (latest.detail as { status: string }).status = "unknown";
    if (failure === "malformed") latest.detail = { answerKeyId: fixture.input.key.answerKeyId };
    if (failure === "wrong protocol") (latest.detail as { protocol: number }).protocol = 99;
    const snapshot = referenceSnapshot([fixture.input], [latest, passed], REFERENCE_NOW);
    expect(snapshot.keys[0].eventId).toBe(2);
    expect(snapshot.keys[0].status).toBe("unknown");
  });

  it("fails closed for missing/unread cap entries, stale, future and changed fee/source identity", () => {
    const fixture = fixtureReference();
    const event = fixtureEvent(fixtureReceipt(fixture));
    expect(referenceSnapshot([fixture.input], [], REFERENCE_NOW).keys[0].reason).toBe("eligibility_missing");
    expect(referenceSnapshot([fixture.input], [event], new Date("2026-10-21T00:00:00Z")).keys[0].reason).toBe("eligibility_stale");
    expect(referenceSnapshot([fixture.input], [event], new Date("2026-10-19T07:00:00Z")).keys[0].reason).toBe("eligibility_stale");
    fixture.input.key.fees[0].amount = 26;
    expect(referenceSnapshot([fixture.input], [event], REFERENCE_NOW).keys[0].reason).toBe("eligibility_identity_changed");
    fixture.input.key.fees[0].amount = 25;
    fixture.input.sources.push({ id: 1, documentUrl: fixture.input.key.documentUrl, contentHash: "new", status: "success",
      supersededById: null, duplicateOfId: null, textId: null, textHash: null, textStatus: null, documentKind: null });
    expect(referenceSnapshot([fixture.input], [event], REFERENCE_NOW).keys[0].reason).toBe("eligibility_identity_changed");
  });

  it.each(["empty", "all unmapped"])("has no measured denominator for %s confirmed fees", (kind) => {
    const fixture = fixtureReference();
    if (kind === "empty") fixture.input.key.fees = [];
    else fixture.input.key.fees[0].canonicalKey = "unmapped";
    expect(fixtureEligibility(fixture).cohort).toMatchObject({ state: "no_measurement", eligibleBanks: 0, eligibleFees: 0, excludedBanks: 1 });
  });
});

describe("latest score projections share reference state", () => {
  it.each(["legacy", "changed", "all excluded", "unavailable", "current"])("gates every metric projection for %s", async (kind) => {
    const fixture = fixtureReference();
    const original = fixtureEligibility(fixture);
    const metadata = kind === "legacy" ? {} : { _reference: original.cohort };
    const row = { id: 12, agent_run_id: 10, scorer_version: 3, scored_at: "2026-10-19T08:00:00Z", banks_scored: 1, fees_expected: 1,
      precision: 1, recall: 1, by_stage: { ...metadata, hamilton: { precision: 1 } }, by_category: { overdraft: { precision: 1 } }, by_document_type: { text_pdf: { precision: 1 } } };
    const db = vi.fn(async () => [row]) as unknown as Parameters<typeof getLatestAnswerKeyScoreRun>[0];
    if (kind === "changed") fixture.input.key.fees[0].amount = 30;
    const snapshot = kind === "all excluded" ? referenceSnapshot([fixture.input], [], REFERENCE_NOW)
      : kind === "changed" ? fixtureEligibility(fixture) : original;
    if(kind==="unavailable") snapshot.readError=true;
    const result = await getLatestAnswerKeyScoreRun(db, 3, snapshot);
    if (kind === "current") {
      expect(result).toMatchObject({ precision: 1, recall: 1, by_category: { overdraft: { precision: 1 } }, referenceState: "measured" });
      expect(result!.by_stage).not.toHaveProperty("_reference");
    } else expect(result).toMatchObject({ precision: null, recall: null, by_stage: {}, by_category: {}, by_document_type: {} });
  });
  it("never compares legacy or edited reference cohorts as extraction improvement", () => {
    const fixture = fixtureReference();
    const before = fixtureEligibility(fixture).cohort;
    expect(referenceScoreCohort({})).toBeNull();
    expect(sameReferenceCohort(before, null)).toBe(false);
    fixture.input.key.fees[0].amount = 25.01;
    expect(sameReferenceCohort(before, fixtureEligibility(fixture).cohort)).toBe(false);
  });
});

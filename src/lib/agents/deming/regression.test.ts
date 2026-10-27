import { describe, expect, it } from "vitest";
import { acceptedTakedown, ACCEPTED_TAKEDOWNS, buildTakedownCase, duplicateOutcome, fieldBacklog, replayFieldCase, restorerAfter, replayOutcome, summarizeDemingRegression, takedownCaseKey, type DemingRegressionResult } from "./regression";
import { compareSeverity, reasonCode, severityFor } from "./severity";
import { replayCase } from "./checkers";

const baseRow = {
  feedback_id: 7,
  reason: "limit_as_fee:name_states_limit: the name says limit",
  fee_published_id: 1427,
  institution_id: 55,
  canonical_fee_key: "od_daily_cap",
  fee_name: "No Bounce Courtesy Pay Limit",
  amount: "600",
  amount_kind: "fixed",
  rate_percent: null,
  source_url: "https://example.test/fees.pdf",
  lineage_ref: 900,
  fee_raw_id: 800,
  source: "knox",
  source_document_id: 12,
  conditions: null,
};

describe("severity scale", () => {
  it("reads the bare reason code", () => {
    expect(reasonCode("limit_as_fee:source_states_limit: text")).toBe("limit_as_fee");
    expect(reasonCode("amount_is_a_threshold the amount")).toBe("amount_is_a_threshold");
    expect(reasonCode(null)).toBe("unknown");
  });

  it("places checks and reasons", () => {
    expect(severityFor("hamilton.limit_guard", "limit_as_fee:x")).toBe("critical");
    expect(severityFor("hamilton.category_guard", "anything")).toBe("major");
    expect(severityFor("hamilton.taxonomy_fold", null)).toBe("info");
    expect(severityFor("hamilton.source_check", "amount_is_a_threshold: x")).toBe("critical");
    expect(severityFor("hamilton.source_check", "tiered_fee: x")).toBe("major");
    expect(severityFor("hamilton.eval_verdict", "wrong_amount: x")).toBe("critical");
    expect(severityFor("hamilton.eval_verdict", "wrong_category: x")).toBe("major");
  });

  it("treats an unknown check as major, never harmless", () => {
    expect(severityFor("hamilton.something_new", "x")).toBe("major");
    expect(severityFor(null, null)).toBe("major");
  });

  it("sorts critical first", () => {
    expect(["info", "critical", "minor", "major"].sort((a, b) => compareSeverity(a as never, b as never))).toEqual(["critical", "major", "minor", "info"]);
  });
});

describe("replayCase", () => {
  it("replays a fee-fields snapshot by the check that caught it (#2064)", () => {
    const takedown = { kind: "unreplayable" as const, canonical_fee_key: "stop_payment", fee_name: "Stop payment of Home Equity Line checks", amount: 25, conditions: null };
    expect(replayCase(takedown, "hamilton.category_guard")).toEqual({ caught: true, verdict: "name_contradicts" });
    // A schedule-contradiction catch needed the schedule's NSF price, which the snapshot lacks: not caught, so it stays a candidate.
    expect(replayCase({ ...takedown, canonical_fee_key: "nsf", fee_name: "Return Item Fee", amount: 10 }, "hamilton.category_guard")?.caught).toBe(false);
    expect(replayCase({ ...takedown, canonical_fee_key: "od_daily_cap", fee_name: "No Bounce Courtesy Pay Limit", amount: 600 }, "hamilton.limit_guard")?.caught).toBe(true);
    // A check with no replayer, or no check named, is not replayed.
    expect(replayCase(takedown, "hamilton.product_page")).toBeNull();
    expect(replayCase(takedown)).toBeNull();
  });

  it("replays a business-schedule takedown against today's audience rules (#2064)", () => {
    const old = { kind: "unreplayable" as const, canonical_fee_key: "overdraft", fee_name: "Balancing Checkbook", amount: 15, conditions: null };
    const apg = "https://www.apgfcu.com/business-service-charges-and-fees-list.html";
    // The document's address names the business schedule: Darwin reads business.
    expect(replayCase(old, "hamilton.business_schedule", { documentUrl: apg, documentText: "Business Service Charges\nBalancing Checkbook $15.00" }))
      .toEqual({ caught: true, verdict: "darwin_reads_business" });
    // Darwin reads with the page, as verify does: a treasury address on a schedule that prices no
    // business fees is Darwin's consumer default, so the business-schedule read never sees it (review of #2064).
    const wire = { kind: "audience" as const, canonical_fee_key: "wire_domestic_outgoing", fee_name: "Outgoing Wire", amount: 30, conditions: null, document_url: "https://bank.test/treasury/fees.pdf" };
    expect(replayCase(wire, null, { documentText: "Schedule of Fees\nOutgoing Wire $30.00\nStop Payment $25.00\nOverdraft Fee $30.00" }))
      .toEqual({ caught: false, verdict: "darwin_reads_consumer" });
    // Darwin leaves a two-column price unknown; the read catches the treasury address.
    expect(replayCase(wire, null, { documentText: "Fees\nPersonal Checking | Business Checking\nOutgoing Wire | $25.00 | $30.00\nStop Payment | $25.00 | $25.00" }))
      .toEqual({ caught: true, verdict: "business_schedule_read" });
    // Darwin reading a business fee as personal lets it through again.
    expect(replayCase({ ...old, fee_name: "Personal Overdraft Fee" }, "hamilton.business_schedule", { documentUrl: "https://bank.test/business/fees.pdf", documentText: "Fees\nPersonal Overdraft Fee $35.00" }))
      .toEqual({ caught: false, verdict: "darwin_reads_consumer" });
    // No stored text: Darwin's decision needs the page, so nothing is judged.
    expect(replayCase(old, "hamilton.business_schedule", { documentUrl: apg })).toBeNull();
    expect(replayCase(wire)).toBeNull();
  });

  it("passes a real fee through the limit guard", () => {
    expect(replayCase({ kind: "limit_guard", canonical_fee_key: "overdraft", fee_name: "Overdraft Fee", amount: 35, conditions: null }))
      .toEqual({ caught: false, verdict: "passes_limit_guard" });
  });

  it("does not claim a source check it could not run", () => {
    const replay = replayCase({
      kind: "source_check",
      fee: { fee_published_id: 1, lineage_ref: 2, fee_raw_id: 3, institution_id: 4, source: "knox", source_document_id: 5, canonical_fee_key: "overdraft", fee_name: "Overdraft", amount: 35, amount_kind: "fixed", rate_percent: null },
      texts: [],
    });
    expect(replay).toEqual({ caught: false, verdict: "no_stored_text" });
  });
});

describe("buildTakedownCase", () => {
  it("freezes a limit-guard takedown as an active critical case", () => {
    const built = buildTakedownCase({ ...baseRow, check_name: "hamilton.limit_guard" }, []);
    expect(built.caseKey).toBe(takedownCaseKey(1427, "hamilton.limit_guard"));
    expect(built.severity).toBe("critical");
    expect(built.errorClass).toBe("limit_as_fee");
    expect(built.status).toBe("active");
    expect(built.lastCaught).toBe(true);
    expect(built.input).toMatchObject({ kind: "limit_guard", amount: 600 });
    expect(built.feeVerifiedId).toBe(900);
  });

  it("keeps a check with no replayer as a candidate", () => {
    const built = buildTakedownCase({ ...baseRow, check_name: "hamilton.product_page", reason: "product_page: x" }, []);
    expect(built.input.kind).toBe("unreplayable");
    expect(built.status).toBe("candidate");
    expect(built.lastCaught).toBeNull();
  });

  it("freezes a category-guard takedown as a case the guard replays (#2064)", () => {
    const built = buildTakedownCase({ ...baseRow, check_name: "hamilton.category_guard", canonical_fee_key: "stop_payment", fee_name: "Stop payment of Home Equity Line checks", amount: "25", reason: "name_contradicts: x" }, []);
    expect(built.input).toMatchObject({ kind: "category_guard", canonical_fee_key: "stop_payment", amount: 25 });
    expect(built.status).toBe("active");
    expect(built.lastVerdict).toBe("name_contradicts");
  });

  it("freezes a business-schedule takedown with its document's address, as an audience case (#2064)", () => {
    const built = buildTakedownCase({ ...baseRow, check_name: "hamilton.business_schedule", canonical_fee_key: "monthly_maintenance", fee_name: "Monthly Service Charge", amount: "20", reason: "business_schedule: consumer fee #9", document_url: "https://bank.test/commercial-fee-schedule.pdf" }, []);
    expect(built.input).toEqual({ kind: "audience", canonical_fee_key: "monthly_maintenance", fee_name: "Monthly Service Charge", amount: 20, conditions: null, document_url: "https://bank.test/commercial-fee-schedule.pdf", darwin_url: null });
    // Promotion reads no page text: the case waits for the replay, which reads the document's text.
    expect(built.status).toBe("candidate");
    expect(built.lastCaught).toBeNull();
    expect(built.severity).toBe("critical");
  });

  it("gives a Knox source-check case only the document Knox read", () => {
    const built = buildTakedownCase(
      { ...baseRow, check_name: "hamilton.source_check", reason: "amount_not_the_fee: x" },
      [
        { institution_id: 55, source_document_id: 12, normalized_text: "Overdraft fee $35", text_hash: "h12" },
        { institution_id: 55, source_document_id: 13, normalized_text: "Other page", text_hash: "h13" },
        { institution_id: 99, source_document_id: 12, normalized_text: "Another bank", text_hash: "h99" },
      ],
    );
    expect(built.input.kind).toBe("source_check");
    if (built.input.kind === "source_check") expect(built.input.texts.map((t) => t.source_document_id)).toEqual([12]);
    expect(built.sourceTextHash).toBe("h12");
  });
});

describe("replayOutcome", () => {
  it("retires a case whose fee came back", () => {
    expect(replayOutcome("active", true, true)).toEqual({ status: "retired", regression: false });
  });
  it("flags an active case the rule no longer catches", () => {
    expect(replayOutcome("active", false, false)).toEqual({ status: "active", regression: true });
  });
  it("promotes a caught candidate and leaves an uncaught one waiting", () => {
    expect(replayOutcome("candidate", true, false)).toEqual({ status: "active", regression: false });
    expect(replayOutcome("candidate", false, false)).toEqual({ status: "candidate", regression: false });
  });
});

describe("replayFieldCase", () => {
  const categoryCase = { status: "candidate", check_name: "hamilton.category_guard", input: { kind: "unreplayable" as const, canonical_fee_key: "stop_payment", fee_name: "Stop payment of Home Equity Line checks", amount: 25, conditions: null } };
  it("activates an old takedown the guard still catches", () => {
    expect(replayFieldCase({ ...categoryCase, fee_live: false })).toMatchObject({ restored: false, outcome: { status: "active", regression: false } });
  });
  it("retires a takedown case whose fee another check brought back while the guard still catches it", () => {
    expect(replayFieldCase({ ...categoryCase, fee_live: true })).toMatchObject({ restored: true, outcome: { status: "retired" } });
  });
  it("reports a regression, not a retirement, when the guard stopped catching an active case and the fee came back (review of #2064)", () => {
    const fine = { ...categoryCase, status: "active", input: { ...categoryCase.input, fee_name: "Stop Payment Fee" } };
    expect(replayFieldCase({ ...fine, fee_live: true })).toMatchObject({ restored: false, outcome: { status: "active", regression: true } });
    // A candidate the guard never caught retires when its fee comes back.
    expect(replayFieldCase({ ...fine, status: "candidate", fee_live: true }).outcome.status).toBe("retired");
  });
  it("flags an active audience case today's rules would let through again (#2064)", () => {
    const audience = { status: "active", check_name: "hamilton.business_schedule", fee_live: false, document_text: "Fees\nOverdraft Fee $35.00",
      input: { kind: "audience" as const, canonical_fee_key: "overdraft", fee_name: "Overdraft Fee", amount: 35, conditions: null, document_url: "https://bank.test/business-fee-schedule.pdf" } };
    expect(replayFieldCase(audience).outcome).toEqual({ status: "active", regression: false });
    // The same fee where Darwin now reads consumer: today's rules would let it through.
    expect(replayFieldCase({ ...audience, input: { ...audience.input, document_url: "https://bank.test/fee-schedule.pdf" } }))
      .toMatchObject({ replay: { caught: false, verdict: "darwin_reads_consumer" }, outcome: { status: "active", regression: true } });
    // No stored text: the case keeps its status, never a regression.
    expect(replayFieldCase({ ...audience, document_text: null }).outcome).toEqual({ status: "active", regression: false });
  });

  it("keeps an audience case through a take-down, a restore and a second take-down (review of #2064)", () => {
    const audience = { status: "candidate", check_name: "hamilton.business_schedule", document_url: "https://www.apgfcu.com/business-service-charges-and-fees-list.html",
      document_text: "Business Service Charges\nBalancing Checkbook $15.00",
      input: { kind: "unreplayable" as const, canonical_fee_key: "overdraft", fee_name: "Balancing Checkbook", amount: 15, conditions: null } };
    // Taken down: the rules catch it.
    const first = replayFieldCase({ ...audience, fee_live: false });
    expect(first.outcome).toEqual({ status: "active", regression: false });
    // Restored because the bank's consumer fee is gone: still a business fee, so the case stays active.
    const restored = replayFieldCase({ ...audience, status: first.outcome.status, fee_live: true });
    expect(restored).toMatchObject({ restored: false, outcome: { status: "active", regression: false } });
    // Taken down again: the same case, still active, still caught.
    expect(replayFieldCase({ ...audience, status: restored.outcome.status, fee_live: false }).outcome).toEqual({ status: "active", regression: false });
    // A candidate the rules catch, live after a restore, does not retire either.
    expect(replayFieldCase({ ...audience, fee_live: true }).outcome.status).toBe("active");
  });

  it("flags an active case the guard no longer catches", () => {
    const fine = { ...categoryCase, status: "active", input: { ...categoryCase.input, fee_name: "Stop Payment Fee" } };
    expect(replayFieldCase({ ...fine, fee_live: false }).outcome).toEqual({ status: "active", regression: true });
  });

  it("gives the limit guard's own cases the live-and-uncaught regression handling (#2064)", () => {
    const limit = { status: "active", check_name: "hamilton.limit_guard", input: { kind: "limit_guard" as const, canonical_fee_key: "od_daily_cap", fee_name: "No Bounce Courtesy Pay Limit", amount: 600, conditions: null } };
    expect(replayFieldCase({ ...limit, fee_live: false }).outcome).toEqual({ status: "active", regression: false });
    // Brought back by another check while the guard still catches it: retired, as before.
    expect(replayFieldCase({ ...limit, fee_live: true })).toMatchObject({ restored: true, outcome: { status: "retired" } });
    // Live again and the guard passes it: the regression is reported and the case stays active.
    const passing = { ...limit, input: { ...limit.input, canonical_fee_key: "overdraft", fee_name: "Overdraft Fee", amount: 35 } };
    expect(replayFieldCase({ ...passing, fee_live: true })).toMatchObject({ restored: false, outcome: { status: "active", regression: true } });
  });

  it("retires an active case only when a reviewed entry says its check's version accepts the fee (#2064)", () => {
    const fine = { ...categoryCase, status: "active", fee_published_id: 77, input: { ...categoryCase.input, fee_name: "Stop Payment Fee" } };
    const entry = { check: "hamilton.category_guard", feePublishedIds: [77], sinceVersion: 1, why: "test", issue: 2064 };
    expect(replayFieldCase({ ...fine, fee_live: true }, [entry])).toMatchObject({ accepted: "accepted:hamilton.category_guard@v1", outcome: { status: "retired", regression: false } });
    // A version the deployed guard has not reached, another fee or another check: still a regression.
    expect(replayFieldCase({ ...fine, fee_live: true }, [{ ...entry, sinceVersion: 100_000 }]).outcome).toEqual({ status: "active", regression: true });
    expect(replayFieldCase({ ...fine, fee_live: true }, [{ ...entry, feePublishedIds: [78] }]).outcome).toEqual({ status: "active", regression: true });
    expect(replayFieldCase({ ...fine, fee_live: true }, [{ ...entry, check: "hamilton.limit_guard" }]).outcome).toEqual({ status: "active", regression: true });
    // A fee the guard catches again keeps its case whatever the list says.
    expect(replayFieldCase({ ...categoryCase, status: "active", fee_published_id: 77, fee_live: false }, [entry]))
      .toMatchObject({ accepted: null, outcome: { status: "active", regression: false } });
    expect(acceptedTakedown("hamilton.limit_guard", 77, [{ ...entry, check: "hamilton.limit_guard", sinceVersion: undefined }])).not.toBeNull();
    expect(ACCEPTED_TAKEDOWNS).toEqual([]);
  });

  it("replays a same-line duplicate on whether the line it repeats is still on the catalog (#2064)", () => {
    const dup = { status: "candidate", check_name: "hamilton.same_line_duplicate", input: { kind: "unreplayable" as const, canonical_fee_key: "stop_payment", fee_name: "Stop Payment Online", amount: 15, conditions: null } };
    expect(replayFieldCase({ ...dup, fee_live: false, kept_line_present: true })).toMatchObject({ replay: { caught: true, verdict: "kept_line_live" }, outcome: { status: "active", regression: false } });
    // Live again beside its kept line: the duplicate is back.
    expect(replayFieldCase({ ...dup, status: "active", fee_live: true, kept_line_present: true }).outcome).toEqual({ status: "active", regression: true });
    // The kept line is gone: Hamilton's restore brings the copy back on purpose; the case waits, never retires.
    expect(replayFieldCase({ ...dup, status: "active", fee_live: true, kept_line_present: false }))
      .toMatchObject({ replay: { verdict: "kept_line_gone" }, outcome: { status: "candidate", regression: false } });
    expect(replayFieldCase({ ...dup, status: "active", fee_live: false, kept_line_present: null }).outcome).toEqual({ status: "active", regression: false });
    expect(duplicateOutcome("candidate", null, true)).toEqual({ status: "candidate", regression: false });
  });

  it("replays wrong-document takedowns on their document's address (#2064)", () => {
    const free = { kind: "unreplayable" as const, canonical_fee_key: "bill_pay", fee_name: "Online Banking with iPay Bill Pay", amount: 0, conditions: "Knox read a free fee from Rosetta artifact #1846." };
    expect(replayCase(free, "hamilton.product_page", { documentUrl: "https://bank.test/personal/checking" })).toEqual({ caught: true, verdict: "product_page" });
    expect(replayCase(free, "hamilton.product_page", { documentUrl: "https://bank.test/fee-schedule.pdf" })).toEqual({ caught: false, verdict: "passes_product_page" });
    expect(replayCase({ ...free, amount: 3 }, "hamilton.product_page", { documentUrl: "https://bank.test/personal/checking" })?.caught).toBe(false);
    expect(replayCase(free, "hamilton.product_page", {})).toBeNull();
    const article = { ...free, canonical_fee_key: "atm_non_network", fee_name: "Withdrawing from an ATM", amount: 4.73 };
    expect(replayCase(article, "hamilton.article_page", { documentUrl: "https://bank.test/learning/atm-fees" })).toEqual({ caught: true, verdict: "article_page" });
    expect(replayCase(article, "hamilton.article_page", { documentUrl: "https://bank.test/fees.pdf" })?.caught).toBe(false);
    const late = { ...free, canonical_fee_key: "late_payment", fee_name: "Late Payment Fee", amount: 25 };
    expect(replayCase(late, "darwin.non_deposit_document", { documentUrl: "https://bank.test/loans/auto-loan-disclosure.pdf", sourceDocumentId: 36058 }))
      .toEqual({ caught: true, verdict: "non_deposit_document" });
    // An address that passes alone is judged only with the text (the opening rules read it).
    expect(replayCase(late, "darwin.non_deposit_document", { documentUrl: "https://bank.test/fees.pdf", sourceDocumentId: 1 })).toBeNull();
    expect(replayCase(late, "darwin.non_deposit_document", { documentUrl: "https://bank.test/fees.pdf", sourceDocumentId: 1, documentText: "Schedule of Fees\nLate Payment Fee $25" }))
      .toEqual({ caught: false, verdict: "passes_non_deposit_document" });
    expect(replayCase(late, "darwin.document_owner", { documentUrl: "https://bank.test/loans/x.pdf", sourceDocumentId: 1 })).toBeNull();
  });

  it("reports a wrong-document fee live while the rule still catches its document, never retires it (review of #2064)", () => {
    const product = { status: "candidate", check_name: "hamilton.product_page", document_url: "https://bank.test/personal/checking",
      input: { kind: "unreplayable" as const, canonical_fee_key: "bill_pay", fee_name: "Online Bill Pay", amount: 0, conditions: "Knox read a free fee from Rosetta artifact #1." } };
    expect(replayFieldCase({ ...product, fee_live: true })).toMatchObject({ restored: false, outcome: { status: "active", regression: true } });
    expect(replayFieldCase({ ...product, fee_live: false }).outcome).toEqual({ status: "active", regression: false });
    // Live on a page today's rule passes: an active case is a regression, a candidate retires (restored).
    expect(replayFieldCase({ ...product, status: "active", document_url: "https://bank.test/fee-schedule.pdf", fee_live: true }).outcome).toEqual({ status: "active", regression: true });
    expect(replayFieldCase({ ...product, document_url: "https://bank.test/fee-schedule.pdf", fee_live: true }).outcome.status).toBe("retired");
  });

  it("names a restorer only from a marker written after the takedown (review of #2064)", () => {
    const markers = [
      { fee_published_id: 5, restored_by: "hamilton.rules_recheck", created_at: "2026-10-01T00:00:00Z" },
      { fee_published_id: 5, restored_by: "hamilton.limit_guard", created_at: "2026-10-20T00:00:00Z" },
    ];
    expect(restorerAfter(markers, "2026-10-10T00:00:00Z")).toBe("hamilton.limit_guard");
    expect(restorerAfter(markers, "2026-10-25T00:00:00Z")).toBeNull();
    expect(restorerAfter(markers, null)).toBe("hamilton.limit_guard");
    expect(restorerAfter([], "2026-10-10T00:00:00Z")).toBeNull();
  });
});

describe("summarizeDemingRegression", () => {
  const result: DemingRegressionResult = {
    schemaReady: true, dryRun: false, promoted: 3, promotedActive: 2,
    promotedBySeverity: { critical: 2, major: 1, minor: 0, info: 0 },
    replayed: 10, caught: 9, regressions: [{ caseId: 1, checkName: "hamilton.limit_guard", severity: "critical", verdict: "passes_limit_guard" }],
    activated: 2, retired: 0, activeTotal: 9, candidateTotal: 4, notJudged: 0,
  };
  it("names counts and regressions", () => {
    expect(summarizeDemingRegression(result)).toBe("Added 3 confirmed mistakes as test cases (2 critical, 1 major). Replayed 10 cases on the deployed rules: 9 still caught, 1 regression: the deployed rules no longer catch a case they used to. 9 active, 4 waiting for a replayer.");
  });
  it("says when the table is missing", () => {
    expect(summarizeDemingRegression({ ...result, schemaReady: false })).toMatch(/not created yet/);
  });
  it("names accepted cases and a CI fixture behind the confirmed cases (#2064)", () => {
    const text = summarizeDemingRegression({ ...result, accepted: 2, fixture: { active: 1015, committed: 21, missing: 994, stale: 0 } });
    expect(text).toContain("Retired 2 cases a reviewed check version accepts.");
    expect(text).toContain("CI fixture behind: 994 active cases not in it, 0 of its cases no longer active.");
    expect(summarizeDemingRegression({ ...result, fixture: { active: 21, committed: 21, missing: 0, stale: 0 } })).not.toContain("CI fixture");
  });
  it("names a failed fee-fields read and a backlog over twice a run's limit (review of #2064)", () => {
    expect(summarizeDemingRegression({ ...result, fieldReadError: "canceling statement due to statement timeout" }))
      .toContain("The fee-fields read failed, so none of those cases was judged this run: canceling statement due to statement timeout.");
    expect(fieldBacklog({ fieldEligible: 5_001, fieldLimit: 2_500 })).toBe(true);
    expect(fieldBacklog({ fieldEligible: 5_000, fieldLimit: 2_500 })).toBe(false);
    expect(fieldBacklog({ fieldEligible: null })).toBe(false);
    expect(summarizeDemingRegression({ ...result, fieldEligible: 5_001, fieldLimit: 2_500 }))
      .toContain("5001 fee-fields cases are due, over twice the 2500 replayed per run");
    expect(summarizeDemingRegression({ ...result, fieldEligible: 2_000, fieldLimit: 2_500 })).not.toContain("fee-fields cases are due");
  });
});

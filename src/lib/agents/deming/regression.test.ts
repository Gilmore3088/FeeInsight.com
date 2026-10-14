import { describe, expect, it } from "vitest";
import { buildTakedownCase, replayOutcome, summarizeDemingRegression, takedownCaseKey, type DemingRegressionResult } from "./regression";
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
    const built = buildTakedownCase({ ...baseRow, check_name: "hamilton.category_guard", reason: "category_mismatch: x" }, []);
    expect(built.input.kind).toBe("unreplayable");
    expect(built.status).toBe("candidate");
    expect(built.lastCaught).toBeNull();
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

describe("summarizeDemingRegression", () => {
  const result: DemingRegressionResult = {
    schemaReady: true, dryRun: false, promoted: 3, promotedActive: 2,
    promotedBySeverity: { critical: 2, major: 1, minor: 0, info: 0 },
    replayed: 10, caught: 9, regressions: [{ caseId: 1, checkName: "hamilton.limit_guard", severity: "critical", verdict: "passes_limit_guard" }],
    activated: 2, retired: 0, activeTotal: 9, candidateTotal: 4,
  };
  it("names counts and regressions", () => {
    expect(summarizeDemingRegression(result)).toBe("Added 3 confirmed mistakes as test cases (2 critical, 1 major). Replayed 10 cases on the deployed rules: 9 still caught, 1 regression: the deployed rules no longer catch a case they used to. 9 active, 4 waiting for a replayer.");
  });
  it("says when the table is missing", () => {
    expect(summarizeDemingRegression({ ...result, schemaReady: false })).toMatch(/not created yet/);
  });
});

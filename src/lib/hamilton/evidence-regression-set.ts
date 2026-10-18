/**
 * Hamilton's evidence regression set (#981, H06-T09): a small, versioned list of cases that
 * every change to the figure check or the evidence contract runs against. It holds the four
 * known false-attribution cases from H06's acceptance text, with valid controls beside them, plus
 * genuine zero and unknown values, rate fees, stale and mixed periods, and incomplete peer coverage.
 *
 * Version 2026-10-18.1 adds the five changes James asked for on #1717: left-out peers are counted
 * and named, event fees with no stated frequency count as per item, a fee new from $0 reads as new,
 * refused comparisons across dates explain themselves, and a fee from a discontinued account's
 * table never binds to a claim about the current fee.
 *
 * Bank A, Bank B and Bank C, their fees and their fixture.invalid URLs are invented. The Texas
 * Capital cases use a real published row the repo records (#1880, hand-takedowns.ts, read Oct 18,
 * 2026): row 134779, "Paid Overdraft Fee", $15, from doc 29087, the closed-account table. Its
 * reporting date and URL are not recorded there, so the cases leave them unknown. No case here is
 * drawn from the demo cast yet: the public fee API could not be reached when this version was
 * built (2026-10-18). The expected outcomes were written by the builder from the contract's rules
 * and James approved them (see HUMAN_REVIEW). The results say how these cases behave, never how accurate the live data is.
 */
import { checkNarrativeFigures, confidenceFromFigureCheck } from "./figure-check";
import {
  claimBindingMatches,
  deriveDifference,
  derivePercentChange,
  peerComparisonCoverage,
  readPeerCoverage,
  type PeerLeftOutReason,
  type HamiltonClaimBinding,
  type HamiltonDerivedFact,
  type HamiltonEvidenceFact,
} from "./evidence-contract";
import { readDerivation, readRefusal } from "./evidence-reading";

export const EVIDENCE_REGRESSION_SET_VERSION = "2026-10-18.1";

/** Who has checked the expected outcomes. Change only with a link to the actual review record. */
export const HUMAN_REVIEW = {
  status: "reviewed" as const,
  tracker: "#1717",
  record: "https://github.com/Gilmore3088/FeeInsight.com/issues/1717#issuecomment-6248897808",
  note: "James approved version 2026-10-18.1 on 2026-10-18 (\"cases ok\"). A new version needs his review again.",
};

const BANK_A = 9001;
const BANK_B = 9002;
const BANK_C = 9003;
/** Texas Capital's institution id in the index (#1880). */
const TEXAS_CAPITAL = 69;
export const REGRESSION_NAMES: ReadonlyMap<number, string> = new Map([
  [BANK_A, "Bank A"], [BANK_B, "Bank B"], [BANK_C, "Bank C"], [TEXAS_CAPITAL, "Texas Capital"],
]);

function fee(id: number, institutionId: number | null, value: number | null, reportingDate: string | null, overrides: Partial<HamiltonEvidenceFact> = {}): HamiltonEvidenceFact {
  return {
    id: `fee:published:${id}`,
    kind: "observed",
    scope: { institutionId, feeCategory: "overdraft", product: "Overdraft", reportingDate, effectiveDate: null, accountApplicability: "consumer" },
    value,
    unit: "usd",
    currency: "USD",
    frequency: "per item",
    conditions: null,
    status: "published",
    source: {
      label: "Published fee catalog", table: "published_fee_catalog", recordId: id, sourceDocumentIds: [id + 100],
      urls: [`https://fixture.invalid/${id}.pdf`], asOf: reportingDate, verificationEventId: null,
    },
    ...overrides,
  };
}

const A10 = fee(1, BANK_A, 10, "2026-06-30");
const B35 = fee(2, BANK_B, 35, "2026-06-30");
const A35 = fee(3, BANK_A, 35, "2026-06-30");
const A0 = fee(4, BANK_A, 0, "2026-06-30");
const A_UNKNOWN = fee(5, BANK_A, null, "2026-06-30");
const A100_2025 = fee(6, BANK_A, 100, "2025-06-30");
const A90_2026 = fee(7, BANK_A, 90, "2026-06-30");
const B35_2024 = fee(8, BANK_B, 35, "2024-06-30");
const B_RATE = fee(9, BANK_B, 3, "2026-06-30", { unit: "percent", currency: null });
const B_PROVISIONAL = fee(10, BANK_B, 35, "2026-06-30", { status: "provisional" });
const B_AUDIENCE_UNKNOWN = fee(11, BANK_B, 35, "2026-06-30", { scope: { ...B35.scope, accountApplicability: "unknown" } });
/** Overdraft is charged each time, so a blank frequency counts as per item (#1717). */
const B_NO_FREQUENCY = fee(12, BANK_B, 35, "2026-06-30", { frequency: null });
const B_PROVISIONAL_2 = fee(15, BANK_C, 30, "2026-06-30", { status: "provisional" });
function monthly(id: number, institutionId: number, value: number, frequency: string | null): HamiltonEvidenceFact {
  const base = fee(id, institutionId, value, "2026-06-30", { frequency });
  return { ...base, scope: { ...base.scope, feeCategory: "monthly_maintenance", product: "Checking" } };
}
function wire(id: number, institutionId: number, value: number, frequency: string | null): HamiltonEvidenceFact {
  const base = fee(id, institutionId, value, "2026-06-30", { frequency });
  return { ...base, scope: { ...base.scope, feeCategory: "wire_domestic_outgoing", product: "Outgoing domestic wire" } };
}
/**
 * Real published row (#1880, hand-takedowns.ts, read Oct 18, 2026): Texas Capital's "Paid Overdraft
 * Fee", $15, from its services-fees page's table for accounts "previously offered and no longer
 * available to open ... as of May 3, 2023" (doc 29087). Reporting date and URL are not recorded.
 */
const TC_DISCONTINUED_OD: HamiltonEvidenceFact = {
  ...fee(134779, TEXAS_CAPITAL, 15, null),
  scope: { institutionId: TEXAS_CAPITAL, feeCategory: "overdraft", product: "Paid Overdraft Fee", reportingDate: null, effectiveDate: null, accountApplicability: "consumer", productStatus: "discontinued" },
  source: { label: "Published fee catalog", table: "published_fee_catalog", recordId: 134779, sourceDocumentIds: [29087], urls: [], asOf: null, verificationEventId: null },
};
/** Fixture (invented): the same discontinued marking on a dated fee, so a comparison's only problem is the status. */
const B_DISCONTINUED = fee(16, BANK_B, 15, "2026-06-30", { scope: { ...B35.scope, productStatus: "discontinued" } });
/** Bank B's $35 less Bank A's $10: a gap between two banks, owned by neither. */
const GAP_B_A = deriveDifference("derived:difference:b-a", B35, A10).fact!;

export type RegressionGroup = "false_attribution" | "control" | "zero_and_unknown" | "rate" | "period" | "coverage" | "event_frequency" | "discontinued";

export type RegressionCase = { id: string; group: RegressionGroup; description: string } & (
  | { check: "figures"; text: string; data: unknown; expect: { level: "high" | "medium" | "low"; unmatched: string[] } }
  | { check: "binding"; fact: HamiltonEvidenceFact | HamiltonDerivedFact; claim: HamiltonClaimBinding; expect: { binds: boolean } }
  /** `reading` is readDerivation's line when the arithmetic stands, readRefusal's when it is refused. */
  | { check: "difference" | "percent_change"; left: HamiltonEvidenceFact; right: HamiltonEvidenceFact; feeLabel?: string;
      expect: { value: number | null; problems?: string[]; reading?: string | null } }
  | { check: "peer_coverage"; own: HamiltonEvidenceFact; peers: HamiltonEvidenceFact[];
      expect: { leftOut: number; byReason: Partial<Record<PeerLeftOutReason, number>>; reading: string | null } }
);

const PEERS = [{ institution_name: "Bank A", fee: 10 }, { institution_name: "Bank B", fee: 35 }];

export const EVIDENCE_REGRESSION_CASES: readonly RegressionCase[] = [
  // The four known false attributions (H06-AC1, AC2). Each "-figure" case records what the
  // number-only figure check does today: it finds the number, rates the answer medium (it never
  // rates anything high) and does NOT catch the false attribution. The "-binding", "-difference"
  // and "-change" case beside it is the check that does.
  { id: "fa-1-figure", group: "false_attribution", description: "figure check alone: \"Bank A charges $35\" matches Bank B's number and is not caught",
    check: "figures", text: "Bank A charges $35.", data: PEERS, expect: { level: "medium", unmatched: [] } },
  { id: "fa-1-binding", group: "false_attribution", description: "Bank B's $35 record doesn't bind to a claim about Bank A",
    check: "binding", fact: B35, claim: { institutionId: BANK_A, feeCategory: "overdraft", unit: "usd" }, expect: { binds: false } },
  { id: "fa-1-own-record", group: "false_attribution", description: "Bank A's own $10 record doesn't support \"Bank A charges $35\"",
    check: "binding", fact: A10, claim: { institutionId: BANK_A, feeCategory: "overdraft", unit: "usd", value: 35 }, expect: { binds: false } },
  { id: "fa-1-category", group: "false_attribution", description: "Bank A's $10 overdraft record doesn't support a $10 NSF claim",
    check: "binding", fact: A10, claim: { institutionId: BANK_A, feeCategory: "nsf", unit: "usd", value: 10 }, expect: { binds: false } },
  { id: "fa-2-figure", group: "false_attribution", description: "figure check alone: \"Bank A charges $25\" matches the gap, not a fee, and is not caught",
    check: "figures", text: "Bank A charges $25.", data: PEERS, expect: { level: "medium", unmatched: [] } },
  { id: "fa-2-difference", group: "false_attribution", description: "the $25 gap keeps both inputs and reads as a gap, not as Bank A's fee",
    check: "difference", left: A10, right: B35,
    expect: { value: -25, reading: "Bank A's overdraft fee is $25 lower than Bank B's ($10 vs $35, both as of Jun 30, 2026)." } },
  { id: "fa-2-own-record", group: "false_attribution", description: "Bank A's own $10 record doesn't support \"Bank A charges $25\"",
    check: "binding", fact: A10, claim: { institutionId: BANK_A, feeCategory: "overdraft", unit: "usd", value: 25 }, expect: { binds: false } },
  { id: "fa-2-gap-as-fee", group: "false_attribution", description: "the $25 gap between two banks doesn't support a claim about Bank A's fee",
    check: "binding", fact: GAP_B_A, claim: { institutionId: BANK_A, feeCategory: "overdraft", unit: "usd", value: 25 }, expect: { binds: false } },
  { id: "fa-3-figure", group: "false_attribution", description: "figure check alone: \"increased by 10%\" for a -10% change is not caught",
    check: "figures", text: "Revenue increased by 10%.", data: { revenue_growth: -10 }, expect: { level: "medium", unmatched: [] } },
  { id: "fa-3-change", group: "false_attribution", description: "a -10% change reads as a fall, with both dates",
    check: "percent_change", left: A90_2026, right: A100_2025,
    expect: { value: -10, reading: "Bank A's overdraft fee fell 10.0%, from $100 (Jun 30, 2025) to $90 (Jun 30, 2026)." } },
  { id: "fa-4-figure", group: "false_attribution", description: "figure check alone: a 2024 value stated as the 2026 fee is not caught",
    check: "figures", text: "The 2026 overdraft fee is $35.", data: { fee: 35, year: 2024 }, expect: { level: "medium", unmatched: [] } },
  { id: "fa-4-binding", group: "false_attribution", description: "a 2024 record doesn't bind to a 2026 claim",
    check: "binding", fact: B35_2024, claim: { institutionId: BANK_B, reportingDate: "2026-06-30" }, expect: { binds: false } },

  // Valid controls: the right record still binds and the right arithmetic still stands.
  { id: "control-figure-unmatched", group: "control", description: "the figure check does catch a number found nowhere in the data",
    check: "figures", text: "Bank A charges $99.", data: PEERS, expect: { level: "low", unmatched: ["$99"] } },
  { id: "control-binding", group: "control", description: "Bank A's own $10 record binds to a claim about Bank A",
    check: "binding", fact: A10, claim: { institutionId: BANK_A, feeCategory: "overdraft", unit: "usd", reportingDate: "2026-06-30" }, expect: { binds: true } },
  { id: "control-binding-value", group: "control", description: "Bank A's own $10 record supports \"Bank A charges $10\" for consumers in 2026",
    check: "binding", fact: A10, claim: { institutionId: BANK_A, feeCategory: "overdraft", unit: "usd", reportingDate: "2026-06-30", value: 10, accountApplicability: "consumer" }, expect: { binds: true } },
  { id: "control-higher", group: "control", description: "a positive gap reads as higher",
    check: "difference", left: B35, right: A10,
    expect: { value: 25, reading: "Bank B's overdraft fee is $25 higher than Bank A's ($35 vs $10, both as of Jun 30, 2026)." } },
  { id: "control-same", group: "control", description: "a zero gap reads as the same, not as a $0 fee",
    check: "difference", left: A35, right: B35,
    expect: { value: 0, reading: "Bank A's overdraft fee is the same as Bank B's ($35 vs $35, both as of Jun 30, 2026)." } },
  { id: "control-rise", group: "control", description: "a rise reads as a rise",
    check: "percent_change", left: fee(13, BANK_A, 110, "2026-06-30"), right: A100_2025,
    expect: { value: 10, reading: "Bank A's overdraft fee rose 10.0%, from $100 (Jun 30, 2025) to $110 (Jun 30, 2026)." } },

  // Genuine zero against unknown (H06-AC3).
  { id: "zero-binds", group: "zero_and_unknown", description: "a genuine $0 fee is a known value and binds",
    check: "binding", fact: A0, claim: { institutionId: BANK_A, unit: "usd" }, expect: { binds: true } },
  { id: "zero-binds-value", group: "zero_and_unknown", description: "a genuine $0 record supports a $0 claim",
    check: "binding", fact: A0, claim: { institutionId: BANK_A, unit: "usd", value: 0 }, expect: { binds: true } },
  { id: "unknown-binds-no-value", group: "zero_and_unknown", description: "an unknown amount doesn't support a $0 claim",
    check: "binding", fact: A_UNKNOWN, claim: { institutionId: BANK_A, unit: "usd", value: 0 }, expect: { binds: false } },
  { id: "zero-difference", group: "zero_and_unknown", description: "a $0 fee still takes part in a comparison",
    check: "difference", left: A0, right: B35,
    expect: { value: -35, reading: "Bank A's overdraft fee is $35 lower than Bank B's ($0 vs $35, both as of Jun 30, 2026)." } },
  { id: "unknown-difference", group: "zero_and_unknown", description: "an unknown amount is never treated as $0",
    check: "difference", left: A_UNKNOWN, right: B35, expect: { value: null, problems: ["non_numeric_value"] } },
  { id: "zero-denominator", group: "zero_and_unknown", description: "no percent change from a $0 starting fee; it reads as a new fee",
    check: "percent_change", left: A10, right: fee(14, BANK_A, 0, "2025-06-30"),
    expect: { value: null, problems: ["zero_denominator"], reading: "Bank A's overdraft fee is a new $10 fee (was $0 on Jun 30, 2025; $10 on Jun 30, 2026)." } },
  { id: "zero-to-zero", group: "zero_and_unknown", description: "$0 then $0 reads as no change, never as a new fee or a percent",
    check: "percent_change", left: A0, right: fee(17, BANK_A, 0, "2025-06-30"),
    expect: { value: null, problems: ["zero_denominator"], reading: "Bank A's overdraft fee did not change, from $0 (Jun 30, 2025) to $0 (Jun 30, 2026)." } },

  // Rate fees are never pooled with dollars.
  { id: "rate-difference", group: "rate", description: "a 3% fee isn't subtracted from a dollar fee",
    check: "difference", left: A10, right: B_RATE, expect: { value: null, problems: ["unit_mismatch", "currency_mismatch"] } },
  { id: "rate-binding", group: "rate", description: "a rate record doesn't bind to a dollar claim",
    check: "binding", fact: B_RATE, claim: { institutionId: BANK_B, unit: "usd" }, expect: { binds: false } },

  // Stale and mixed periods.
  { id: "mixed-period-difference", group: "period", description: "two banks' fees from different dates aren't one comparison",
    check: "difference", left: A10, right: B35_2024,
    expect: { value: null, problems: ["reporting_period_mismatch"],
      reading: "Not compared: Bank A's $10 is as of Jun 30, 2026 and Bank B's $35 is as of Jun 30, 2024; fees from different dates aren't one comparison." } },
  { id: "reversed-change", group: "period", description: "an older value isn't the 'current' side of a change, and the refusal says why",
    check: "percent_change", left: A100_2025, right: A90_2026,
    expect: { value: null, problems: ["reporting_period_order_invalid"],
      reading: "Not compared as a change: Bank A's $100 (Jun 30, 2025) is older than its $90 (Jun 30, 2026), so it can't be the current overdraft fee." } },
  { id: "same-date-change", group: "period", description: "two values from one date are not a change over time",
    check: "percent_change", left: A90_2026, right: A10,
    expect: { value: null, problems: ["reporting_period_order_invalid"],
      reading: "Not compared as a change: both of Bank A's overdraft fees are as of Jun 30, 2026 ($90 and $10), so neither is the earlier one." } },
  { id: "cross-bank-change", group: "period", description: "a change between two banks isn't a change over time",
    check: "percent_change", left: B35, right: A100_2025, expect: { value: null, problems: ["institution_mismatch"] } },

  // Incomplete peer coverage: a peer value without full lineage is not compared.
  { id: "provisional-peer", group: "coverage", description: "a provisional peer fee isn't used in a comparison",
    check: "difference", left: A10, right: B_PROVISIONAL, expect: { value: null, problems: ["source_record_unverified"] } },
  { id: "unknown-audience-peer", group: "coverage", description: "a peer fee of unknown audience isn't used",
    check: "difference", left: A10, right: B_AUDIENCE_UNKNOWN, expect: { value: null, problems: ["consumer_audience_unverified"] } },
  { id: "unknown-audience-binding", group: "coverage", description: "a fee of unknown audience doesn't support a consumer claim",
    check: "binding", fact: B_AUDIENCE_UNKNOWN, claim: { institutionId: BANK_B, value: 35, accountApplicability: "consumer" }, expect: { binds: false } },
  { id: "business-claim-binding", group: "coverage", description: "a consumer fee doesn't support a business-account claim",
    check: "binding", fact: B35, claim: { institutionId: BANK_B, value: 35, accountApplicability: "business" }, expect: { binds: false } },

  // Left-out peers are counted and named (#1717); "0 of N left out" is never shown.
  { id: "coverage-left-out-mixed", group: "coverage", description: "3 of 4 peers left out, grouped by reason in one line",
    check: "peer_coverage", own: A10, peers: [B35, B_PROVISIONAL, B_PROVISIONAL_2, B_AUDIENCE_UNKNOWN],
    expect: { leftOut: 3, byReason: { not_verified: 2, audience_unknown: 1 }, reading: "3 of 4 peers left out: 2 not yet verified, 1 audience unknown." } },
  { id: "coverage-left-out-one-reason", group: "coverage", description: "one reason reads without a count",
    check: "peer_coverage", own: A10, peers: [B35, B_PROVISIONAL],
    expect: { leftOut: 1, byReason: { not_verified: 1 }, reading: "1 of 2 peers left out: not yet verified." } },
  { id: "coverage-none-left-out", group: "coverage", description: "no line when no peer is left out",
    check: "peer_coverage", own: A10, peers: [B35, B_NO_FREQUENCY],
    expect: { leftOut: 0, byReason: {}, reading: null } },
  { id: "coverage-recurring-no-frequency", group: "coverage", description: "a monthly fee with no stated frequency is left out and named",
    check: "peer_coverage", own: monthly(20, BANK_A, 12, "monthly"), peers: [monthly(21, BANK_B, 10, "monthly"), monthly(22, BANK_C, 15, null)],
    expect: { leftOut: 1, byReason: { frequency_unknown: 1 }, reading: "1 of 2 peers left out: no stated frequency." } },

  // Event fees charged each time count as per item when the schedule doesn't say (#1717).
  { id: "event-no-frequency-peer", group: "event_frequency", description: "an overdraft fee with no stated frequency is compared as per item",
    check: "difference", left: A10, right: B_NO_FREQUENCY,
    expect: { value: -25, reading: "Bank A's overdraft fee is $25 lower than Bank B's ($10 vs $35, both as of Jun 30, 2026)." } },
  { id: "event-wire-no-frequency", group: "event_frequency", description: "an outgoing wire fee with no stated frequency is compared as per item",
    check: "difference", left: wire(23, BANK_A, 25, "per item"), right: wire(24, BANK_B, 30, null), feeLabel: "outgoing wire",
    expect: { value: -5, reading: "Bank A's outgoing wire fee is $5 lower than Bank B's ($25 vs $30, both as of Jun 30, 2026)." } },
  { id: "event-no-frequency-vs-periodic", group: "event_frequency", description: "a blank event fee doesn't match a fee stated per month",
    check: "difference", left: fee(25, BANK_A, 10, "2026-06-30", { frequency: "monthly" }), right: B_NO_FREQUENCY,
    expect: { value: null, problems: ["fee_frequency_mismatch"] } },
  { id: "recurring-no-frequency", group: "event_frequency", description: "a monthly maintenance fee with no stated frequency still isn't compared",
    check: "difference", left: monthly(26, BANK_A, 12, "monthly"), right: monthly(27, BANK_B, 10, null),
    expect: { value: null, problems: ["fee_frequency_unknown"] } },

  // A fee from a discontinued account's table is never the current fee (#1880, #1717).
  { id: "discontinued-current-claim", group: "discontinued", description: "Texas Capital's closed-account $15 overdraft row doesn't support \"Texas Capital charges $15\"",
    check: "binding", fact: TC_DISCONTINUED_OD, claim: { institutionId: TEXAS_CAPITAL, feeCategory: "overdraft", unit: "usd", value: 15 }, expect: { binds: false } },
  { id: "discontinued-stated-claim", group: "discontinued", description: "the same row supports a claim that names it a discontinued account's fee",
    check: "binding", fact: TC_DISCONTINUED_OD, claim: { institutionId: TEXAS_CAPITAL, feeCategory: "overdraft", unit: "usd", value: 15, productStatus: "discontinued" }, expect: { binds: true } },
  { id: "discontinued-difference", group: "discontinued", description: "a discontinued account's fee isn't compared with a current one",
    check: "difference", left: A10, right: B_DISCONTINUED, expect: { value: null, problems: ["product_discontinued"] } },
];

export interface RegressionResult {
  id: string;
  group: RegressionGroup;
  pass: boolean;
  /** What happened, in a line, so a failing run says why. */
  actual: string;
}

export function runRegressionCase(c: RegressionCase): RegressionResult {
  const done = (pass: boolean, actual: string): RegressionResult => ({ id: c.id, group: c.group, pass, actual });
  if (c.check === "figures") {
    const check = checkNarrativeFigures(c.text, c.data);
    const level = confidenceFromFigureCheck(check).level;
    const sameUnmatched = check.unmatched.length === c.expect.unmatched.length && check.unmatched.every((u, i) => u === c.expect.unmatched[i]);
    return done(level === c.expect.level && sameUnmatched, `confidence ${level}; unmatched [${check.unmatched.join(", ")}]`);
  }
  if (c.check === "binding") {
    const binds = claimBindingMatches(c.fact, c.claim);
    return done(binds === c.expect.binds, binds ? "binds" : "does not bind");
  }
  if (c.check === "peer_coverage") {
    const coverage = peerComparisonCoverage(c.own, c.peers);
    const reading = readPeerCoverage(coverage);
    const leftOut = coverage?.leftOut ?? 0;
    const byReason = coverage?.byReason ?? {};
    const expectedReasons = Object.entries(c.expect.byReason).filter(([, n]) => n);
    const sameReasons = expectedReasons.length === Object.keys(byReason).length
      && expectedReasons.every(([reason, n]) => byReason[reason as PeerLeftOutReason] === n);
    return done(leftOut === c.expect.leftOut && sameReasons && reading === c.expect.reading,
      `${leftOut} of ${c.peers.length} left out ${JSON.stringify(byReason)}; ${reading ? `"${reading}"` : "no line"}`);
  }
  const result = c.check === "difference" ? deriveDifference(`regression:${c.id}`, c.left, c.right) : derivePercentChange(`regression:${c.id}`, c.left, c.right);
  const value = result.fact?.value ?? null;
  const feeLabel = c.feeLabel ?? "overdraft";
  const reading = result.fact
    ? readDerivation(result.fact, [c.left, c.right], REGRESSION_NAMES, feeLabel)
    : readRefusal(result.problems, c.left, c.right, REGRESSION_NAMES, feeLabel);
  const expected = [...(c.expect.problems ?? [])].sort();
  const actualProblems = [...new Set(result.problems)].sort();
  const problemsMatch = expected.length === actualProblems.length && expected.every((p, i) => p === actualProblems[i]);
  const readingMatches = c.expect.reading === undefined || reading === c.expect.reading;
  return done(value === c.expect.value && problemsMatch && readingMatches,
    `value ${value ?? "none"}; problems [${result.problems.join(", ")}]${reading ? `; "${reading}"` : ""}`);
}

/** Every case's result, with the denominator, for a test or a reviewer. */
export function runEvidenceRegressionSet(cases: readonly RegressionCase[] = EVIDENCE_REGRESSION_CASES) {
  const results = cases.map(runRegressionCase);
  return { version: EVIDENCE_REGRESSION_SET_VERSION, humanReview: HUMAN_REVIEW, passed: results.filter((r) => r.pass).length, total: results.length, results };
}

/**
 * Fact IDs for the filing and filed-peer figures a written answer reads (claim contract step 1,
 * #1077). Each adapter reads only server-observed tool reads and keeps the validation the
 * existing reader already does (profile-quarter-evidence, answer-derivations, filed-peer-evidence),
 * so no new trust is granted. A written answer's sentence binding reads them (step 2,
 * `writtenAnswerBinding`): a filing figure is supported only by a fact of the institution, metric,
 * period and period basis the sentence states.
 *
 * A filing row has no numeric id in the tool output, so its ID is a natural key that names its
 * period basis: an NCUA profile row is year to date and the filed peer view's row for the same
 * quarter is a standalone quarter, so the two never share an ID. Two reads giving one ID different
 * values give no fact for that ID, and nothing derived from it. The profile's revenue trend gives
 * standalone quarters under the same key as the filed peer view's, and a fee-income change is
 * derived from two of them (Cycle A defect 10). Pure: no read, no model call.
 */
import { financialMeasureDefinition, financialSourceForCharter } from "@/lib/data-store/financial-peer-contract";
import { ncuaFilingInputs } from "./answer-derivations";
import { HAMILTON_EVIDENCE_CONTRACT_VERSION, PEER_MEDIAN_FORMULA, type HamiltonDerivedFact, type HamiltonEvidenceBundle, type HamiltonEvidenceFact, type HamiltonPeriodBasis } from "./evidence-contract";
import { filedPeerIncomeReadings } from "./filed-peer-evidence";
import { dollarUnitScale, percentageUnitScale } from "./monetary-units";
import { profileQuarterCalculations } from "./profile-quarter-evidence";
import type { AnswerToolEvidence } from "./written-answer-evidence";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const quarterEnd = (value: unknown): value is string => typeof value === "string" && /^20\d{2}-(?:03-31|06-30|09-30|12-31)$/.test(value);

export const SHORTENED_PEER_LIST_LIMITATION =
  "A filed peer median's peer list was shortened, so its median names no peer rows and is not recomputed from them.";

/** One institution's filed figure: `filing:<source>:<institution>:<report date>:<metric>:<period basis>`. */
export function filingFactId(source: string, institutionId: number, reportDate: string, metric: string, basis: HamiltonPeriodBasis): string {
  return `filing:${source}:${institutionId}:${reportDate}:${metric}:${basis}`;
}

/** FNV-1a: a short, stable name for a peer group's canonical filters, not a security hash. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

// The profile's filed fields. Balances are quarter-end; income and the fee-income ratio follow the filing's own basis.
const PROFILE_FIELDS = [
  { field: "service_charge_income", unit: "usd", balance: false },
  { field: "total_revenue", unit: "usd", balance: false },
  { field: "total_assets", unit: "usd", balance: true },
  { field: "total_deposits", unit: "usd", balance: true },
  { field: "fee_income_ratio", unit: "ratio", balance: false },
] as const;

function filingFact(input: {
  source: "fdic" | "ncua"; institutionId: number; reportDate: string; metric: string; basis: HamiltonPeriodBasis;
  value: number; unit: "usd" | "count" | "ratio"; label: string; table: string; urls?: string[]; retrievedAt?: string | null;
}): HamiltonEvidenceFact {
  const id = filingFactId(input.source, input.institutionId, input.reportDate, input.metric, input.basis);
  return {
    id, kind: "observed",
    scope: { institutionId: input.institutionId, feeCategory: null, product: null, reportingDate: input.reportDate, effectiveDate: null,
      accountApplicability: "unknown", metric: input.metric, periodBasis: input.basis, cohortKey: null },
    value: input.value, unit: input.unit, currency: input.unit === "usd" ? "USD" : null, frequency: null, conditions: null,
    status: "published",
    source: { label: input.label, table: input.table, recordId: null, recordKey: id, evidenceClass: "filing", sourceDocumentIds: [],
      urls: input.urls ?? [], asOf: input.reportDate, retrievedAt: input.retrievedAt ?? null, verificationEventId: null },
  };
}

/** The period basis each source's profile definition must state: NCUA files year to date, the FDIC by quarter. */
const PROFILE_PERIOD_BASIS = { ncua: "year_to_date", fdic: "standalone_quarter" } as const;

/** getInstitution's `financials` rows, validated as profileQuarterCalculations reads them. */
function profileFilingFacts(reads: readonly AnswerToolEvidence[]): HamiltonEvidenceFact[] {
  const facts: HamiltonEvidenceFact[] = [];
  const conflicting = new Set<string>();
  for (const read of reads.slice(-40)) {
    if (read.toolName !== "getInstitution") continue;
    const id = record(read.input)?.id;
    const output = record(read.output);
    const identity = record(output?.identity);
    const financials = record(output?.financials);
    const definition = record(financials?.definition);
    const source = financialSourceForCharter(identity?.charter_type);
    if (!positiveId(id) || identity?.id !== id || !source || definition?.source !== source || !Array.isArray(financials?.records)) continue;
    // The definition must be the source's own: measure, publisher, unit and the period basis its filings use.
    const expected = financialMeasureDefinition(source);
    if (definition.measure !== expected.measure || definition.unit !== expected.unit || definition.publisher !== expected.publisher
      || definition.period_basis !== PROFILE_PERIOD_BASIS[source]) continue;
    const basis: HamiltonPeriodBasis = source === "ncua" ? "ytd" : "standalone_quarter";
    for (const raw of [financials.latest, ...financials.records.slice(0, 8)]) {
      const row = record(raw);
      if (row?.institution_id !== id || row.source !== source || !quarterEnd(row.report_date)) continue;
      const fieldUnits = record(row.field_units);
      for (const { field, unit, balance } of PROFILE_FIELDS) {
        const value = row[field];
        if (value === null || value === undefined) continue;
        // A unit counts only where it is stated: an explicit null never falls through to the response's units.
        const stated = fieldUnits && Object.hasOwn(fieldUnits, field) ? fieldUnits[field]
          : Object.hasOwn(row, "unit") ? row.unit : Object.hasOwn(row, "units") ? row.units : financials.units;
        const scale = unit === "ratio" ? (percentageUnitScale(stated) === 100 ? 1 : null) : dollarUnitScale(stated);
        // A value or unit that cannot be read makes the whole date conflicting, as profileQuarterCalculations does.
        if (typeof value !== "number" || !Number.isFinite(value) || scale === null || (unit === "usd" && value < 0)) {
          conflicting.add(`${id}:${row.report_date}`);
          continue;
        }
        facts.push(filingFact({ source, institutionId: id, reportDate: row.report_date, metric: field, basis: balance ? "point_in_time" : basis,
          value: value * scale, unit, label: expected.publisher, table: "institution_financial_records" }));
      }
    }
  }
  return facts.filter((fact) => !conflicting.has(`${fact.scope.institutionId}:${fact.scope.reportingDate}`));
}

const TREND_QUARTER = /^(20\d{2})-?Q([1-4])$/;
const QUARTER_ENDS = ["03-31", "06-30", "09-30", "12-31"] as const;

/**
 * getInstitution's `revenue_trend` quarters (#1077, Cycle A defect 10): each a standalone quarter
 * of the profile's own measure, owned by the profile's institution (the rows carry no id of their
 * own) and keyed as the filed peer view keys a standalone quarter, so the same quarter read twice
 * is one fact and two values for it are none. The definition must be the source's own, stating a
 * standalone-quarter basis; each row must state its own source and unit. The tool's
 * `yoy_change_pct` is never a fact: the change is derived from two of these quarters
 * (`trendChangeDerivations`), so it names both inputs.
 */
function trendFilingFacts(reads: readonly AnswerToolEvidence[]): HamiltonEvidenceFact[] {
  const facts: HamiltonEvidenceFact[] = [];
  const conflicting = new Set<string>();
  for (const read of reads.slice(-40)) {
    if (read.toolName !== "getInstitution") continue;
    const id = record(read.input)?.id;
    const output = record(read.output);
    const identity = record(output?.identity);
    const definition = record(output?.revenue_trend_definition);
    const source = financialSourceForCharter(identity?.charter_type);
    if (!positiveId(id) || identity?.id !== id || !source || definition?.source !== source || !Array.isArray(output?.revenue_trend)) continue;
    const expected = financialMeasureDefinition(source);
    if (definition.measure !== expected.measure || definition.unit !== expected.unit || definition.publisher !== expected.publisher
      || definition.charter_type !== expected.charter_type || definition.period_basis !== "standalone_quarter") continue;
    // The trend rows carry no id; a read whose filed rows name another institution is not trusted for them either.
    const financials = record(output.financials);
    const filed = [financials?.latest, ...(Array.isArray(financials?.records) ? financials.records : [])].map(record).filter((row) => row !== null);
    if (filed.some((row) => row.institution_id !== id)) continue;
    for (const raw of output.revenue_trend.slice(0, 8)) {
      const row = record(raw);
      const match = typeof row?.quarter === "string" ? TREND_QUARTER.exec(row.quarter) : null;
      if (!row || !match || row.source !== source) continue;
      const reportDate = `${match[1]}-${QUARTER_ENDS[Number(match[2]) - 1]}`;
      const fieldUnits = record(row.field_units);
      // The row's own unit only: the trend's definition is a sibling, not the row.
      const stated = fieldUnits && Object.hasOwn(fieldUnits, "service_charge_income") ? fieldUnits.service_charge_income
        : Object.hasOwn(row, "unit") ? row.unit : row.units;
      const scale = dollarUnitScale(stated);
      const value = row.service_charge_income;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || scale === null) {
        conflicting.add(`${id}:${reportDate}`);
        continue;
      }
      facts.push(filingFact({ source, institutionId: id, reportDate, metric: "service_charge_income", basis: "standalone_quarter",
        value: value * scale, unit: "usd", label: expected.publisher, table: "institution_financial_records" }));
    }
  }
  return facts.filter((fact) => !conflicting.has(`${fact.scope.institutionId}:${fact.scope.reportingDate}`));
}

/** The quarter end `back` quarters before a quarter end. */
function quarterEndBefore(date: string, back: number): string {
  const index = Number(date.slice(0, 4)) * 4 + QUARTER_ENDS.indexOf(date.slice(5) as (typeof QUARTER_ENDS)[number]) - back;
  return `${Math.floor(index / 4)}-${QUARTER_ENDS[index % 4]}`;
}

/** The comparisons a change is derived for, as the NCUA ledger derives them (answer-derivations.ts), in quarters back. */
const TREND_COMPARISONS = [["year_over_year", 4], ["quarter_over_quarter", 1]] as const;

/**
 * The percent change in an institution's standalone-quarter fee income against the same quarter a
 * year earlier and against the quarter before: two filed quarters of the same institution, source
 * and metric, both named as inputs (current first, baseline second, the order derivationHolds
 * recomputes in). Only the exact baseline quarter counts: with that filing missing there is no
 * change, never one taken over a longer span. Rounded to one decimal, as the tool and the evidence
 * contract round a change.
 */
function trendChangeDerivations(facts: ReadonlyMap<string, HamiltonEvidenceFact>): HamiltonDerivedFact[] {
  const out: HamiltonDerivedFact[] = [];
  for (const current of facts.values()) {
    const { institutionId, reportingDate, metric, periodBasis } = current.scope;
    const source = current.id.split(":")[1];
    if (current.source.evidenceClass !== "filing" || metric !== "service_charge_income" || periodBasis !== "standalone_quarter"
      || current.unit !== "usd" || typeof current.value !== "number" || institutionId === null || !quarterEnd(reportingDate)
      || (source !== "fdic" && source !== "ncua")) continue;
    for (const [comparison, back] of TREND_COMPARISONS) {
      const prior = facts.get(filingFactId(source, institutionId, quarterEndBefore(reportingDate, back), metric, "standalone_quarter"));
      if (!prior || typeof prior.value !== "number" || prior.value <= 0) continue;
      const pct = Math.round(((current.value - prior.value) / prior.value) * 1000) / 10;
      if (!Number.isFinite(pct)) continue;
      out.push({
        id: `change:${source}:${institutionId}:${reportingDate}:${metric}:standalone_quarter:${comparison}`, kind: "derived",
        scope: { institutionId, feeCategory: null, product: null, reportingDate, effectiveDate: null,
          accountApplicability: "unknown", metric, periodBasis: "standalone_quarter", cohortKey: null },
        value: pct, unit: "percent", currency: null, status: "derived",
        derivation: { kind: "percent_change", inputFactIds: [current.id, prior.id], denominatorFactId: prior.id,
          formula: "(current - prior) / prior * 100", rounding: "one decimal percentage point" },
      });
    }
  }
  return out;
}

/**
 * An NCUA standalone quarter must be its year-to-date filing less the prior quarter's (Q1 as
 * filed) wherever both are read; one that is not names no fact, as profileQuarterCalculations
 * drops a trend row that disagrees with the totals.
 */
function quarterDisagreesWithYtd(fact: HamiltonEvidenceFact, facts: ReadonlyMap<string, HamiltonEvidenceFact>): boolean {
  const { institutionId, reportingDate, metric, periodBasis } = fact.scope;
  if (!fact.id.startsWith("filing:ncua:") || metric !== "service_charge_income" || periodBasis !== "standalone_quarter"
    || institutionId === null || !quarterEnd(reportingDate) || typeof fact.value !== "number") return false;
  const ytd = facts.get(filingFactId("ncua", institutionId, reportingDate, metric, "ytd"))?.value;
  if (typeof ytd !== "number") return false;
  if (reportingDate.endsWith("03-31")) return Math.abs(ytd - fact.value) > 0.5;
  const before = facts.get(filingFactId("ncua", institutionId, quarterEndBefore(reportingDate, 1), metric, "ytd"))?.value;
  return typeof before === "number" && Math.abs(ytd - before - fact.value) > 0.5;
}

/** queryData institution reads of the curated NCUA call lines, validated by the NCUA ledger's own reader. */
function callItemFacts(reads: readonly AnswerToolEvidence[]): HamiltonEvidenceFact[] {
  return ncuaFilingInputs(reads.filter((read) => read.toolName === "queryData")).map((input) => filingFact({
    source: "ncua", institutionId: input.institution_id, reportDate: input.report_date, metric: input.measure, basis: input.period_basis,
    value: input.value, unit: input.unit === "USD" ? "usd" : "count", label: input.publisher, table: "institution_call_report_items",
    urls: [input.source_url], retrievedAt: input.fetched_at,
  }));
}

/** queryFeeRevenueCorrelation peers: the subject's and each listed peer's quarter, and the peer median. */
function filedPeerFacts(reads: readonly AnswerToolEvidence[], institutionId: number | null) {
  const facts: HamiltonEvidenceFact[] = [];
  const derivations: HamiltonDerivedFact[] = [];
  const limitations: string[] = [];
  for (const { observation, comparisonKey, peers, complete } of filedPeerIncomeReadings(reads, institutionId).readings) {
    const { source, report_date: reportDate } = observation;
    const label = financialMeasureDefinition(source).publisher;
    const fact = (id: number, value: number) => filingFact({ source, institutionId: id, reportDate, metric: "service_charge_income",
      basis: "standalone_quarter", value, unit: "usd", label, table: "institution_financial_records" });
    facts.push(fact(observation.institution_id, observation.subject_income_usd));
    const peerFacts = (peers ?? []).map((peer) => fact(peer.institution_id, peer.service_charge_income_usd));
    facts.push(...peerFacts);
    if (observation.peer_median_income_usd === null) continue;
    // The subject is excluded from its own peers, so the group is named with it.
    const cohortKey = `filed_peers:${source}:${reportDate}:${shortHash(JSON.stringify([observation.institution_id, comparisonKey]))}`;
    const named = peers !== null && complete;
    if (!named) limitations.push(SHORTENED_PEER_LIST_LIMITATION);
    derivations.push({
      id: `stat:${cohortKey}:median`, kind: "derived",
      scope: { institutionId: null, feeCategory: null, product: null, reportingDate: reportDate, effectiveDate: null,
        accountApplicability: "unknown", metric: "service_charge_income", periodBasis: "standalone_quarter", cohortKey },
      value: observation.peer_median_income_usd, unit: "usd", currency: "USD", status: "derived",
      derivation: { kind: "peer_median", inputFactIds: named ? peerFacts.map((peer) => peer.id) : [], denominatorFactId: null,
        formula: PEER_MEDIAN_FORMULA, rounding: "as filed, in thousands of dollars" },
    });
  }
  return { facts, derivations, limitations };
}

/**
 * The claim facts in a written answer's server-observed reads. The same reads give the same IDs;
 * an ID two reads disagree on gives no fact, and a derivation that needs it is dropped.
 */
export function claimEvidenceFacts(reads: readonly AnswerToolEvidence[], institutionId: number | null = null): HamiltonEvidenceBundle {
  const peers = filedPeerFacts(reads, institutionId);
  const facts = new Map<string, HamiltonEvidenceFact>();
  const conflicts = new Set<string>();
  for (const fact of [...profileFilingFacts(reads), ...trendFilingFacts(reads), ...callItemFacts(reads), ...peers.facts]) {
    const previous = facts.get(fact.id);
    if (!previous) facts.set(fact.id, fact);
    else if (previous.value !== fact.value || previous.unit !== fact.unit) conflicts.add(fact.id);
  }
  for (const fact of facts.values()) if (quarterDisagreesWithYtd(fact, facts)) conflicts.add(fact.id);
  for (const id of conflicts) facts.delete(id);
  const derivations: HamiltonDerivedFact[] = [...peers.derivations, ...trendChangeDerivations(facts)];
  for (const calculation of profileQuarterCalculations(reads)) {
    const inputIds = calculation.inputs.map((input) => filingFactId("ncua", input.institution_id, input.report_date, "service_charge_income", "ytd"));
    // The profile's quarter is derived from the same rows; it stands only while both rows do, at the same values.
    if (!inputIds.every((id, index) => facts.get(id)?.value === calculation.inputs[index].value)) continue;
    derivations.push({
      id: calculation.id, kind: "derived",
      scope: { institutionId: calculation.institution_id, feeCategory: null, product: null, reportingDate: calculation.report_date, effectiveDate: null,
        accountApplicability: "unknown", metric: "service_charge_income", periodBasis: "standalone_quarter", cohortKey: null },
      value: calculation.value, unit: "usd", currency: "USD", status: "derived",
      derivation: { kind: "ytd_to_quarter", inputFactIds: inputIds, denominatorFactId: null, formula: calculation.expression, rounding: "none" },
    });
  }
  const kept = derivations.filter((derived) => derived.derivation.inputFactIds.every((id) => facts.has(id)));
  return {
    version: HAMILTON_EVIDENCE_CONTRACT_VERSION,
    generatedAt: new Date(0).toISOString(),
    facts: [...facts.values()],
    derivations: kept,
    limitations: [...new Set(peers.limitations)],
  };
}

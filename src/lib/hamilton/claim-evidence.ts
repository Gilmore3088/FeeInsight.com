/**
 * Fact IDs for the filing and filed-peer figures a written answer reads (claim contract step 1,
 * #1077). Each adapter reads only server-observed tool reads and keeps the validation the
 * existing reader already does (profile-quarter-evidence, answer-derivations, filed-peer-evidence),
 * so no new trust is granted. Nothing binds a sentence to these facts yet: `claimBindingMatches`
 * and `bindNarrative` still see fee records only (step 2).
 *
 * A filing row has no numeric id in the tool output, so its ID is a natural key that names its
 * period basis: an NCUA profile row is year to date and the filed peer view's row for the same
 * quarter is a standalone quarter, so the two never share an ID. Two reads giving one ID different
 * values give no fact for that ID, and nothing derived from it. Pure: no read, no model call.
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

/** getInstitution's `financials` rows, validated as profileQuarterCalculations reads them. */
function profileFilingFacts(reads: readonly AnswerToolEvidence[]): HamiltonEvidenceFact[] {
  const facts: HamiltonEvidenceFact[] = [];
  for (const read of reads.slice(-40)) {
    if (read.toolName !== "getInstitution") continue;
    const id = record(read.input)?.id;
    const output = record(read.output);
    const identity = record(output?.identity);
    const financials = record(output?.financials);
    const definition = record(financials?.definition);
    const source = financialSourceForCharter(identity?.charter_type);
    if (!positiveId(id) || identity?.id !== id || !source || definition?.source !== source || !Array.isArray(financials?.records)
      || definition.measure !== financialMeasureDefinition(source).measure || typeof definition.publisher !== "string") continue;
    const basis: HamiltonPeriodBasis | null = definition.period_basis === "year_to_date" ? "ytd" : definition.period_basis === "standalone_quarter" ? "standalone_quarter" : null;
    if (!basis) continue;
    for (const raw of [financials.latest, ...financials.records.slice(0, 8)]) {
      const row = record(raw);
      if (row?.institution_id !== id || row.source !== source || !quarterEnd(row.report_date)) continue;
      for (const { field, unit, balance } of PROFILE_FIELDS) {
        const value = row[field];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        const stated = record(row.field_units)?.[field] ?? row.unit ?? row.units ?? financials.units;
        const scale = unit === "ratio" ? (percentageUnitScale(stated) === 100 ? 1 : null) : dollarUnitScale(stated);
        if (scale === null || (unit === "usd" && value < 0)) continue;
        facts.push(filingFact({ source, institutionId: id, reportDate: row.report_date, metric: field, basis: balance ? "point_in_time" : basis,
          value: value * scale, unit, label: definition.publisher, table: "institution_financial_records" }));
      }
    }
  }
  return facts;
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
  for (const fact of [...profileFilingFacts(reads), ...callItemFacts(reads), ...peers.facts]) {
    const previous = facts.get(fact.id);
    if (!previous) facts.set(fact.id, fact);
    else if (previous.value !== fact.value || previous.unit !== fact.unit) conflicts.add(fact.id);
  }
  for (const id of conflicts) facts.delete(id);
  const derivations: HamiltonDerivedFact[] = [...peers.derivations];
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

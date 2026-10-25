/**
 * Bounded semantic checks for the NCUA measures Hamilton can currently discover.
 * These catch known substitutions in the five-question NCUA evaluation, not arbitrary
 * natural-language truth. Numerical/source checks remain separate and the source hold
 * remains the caller's responsibility. Discovery alone never proves a reported value.
 */

import { extractFigures, tierBoundsAsSize } from "./figure-check";
import { financialSourceForCharter, validFinancialPeerComparison } from "@/lib/data-store/financial-peer-contract";
import { MIN_PEERS_FOR_POSITION } from "./workspace/scenario";

export const HAMILTON_INTERPRETATION_INSTRUCTION = `
SOURCE MEANING:
- An NCUA share-draft count is accounts, not members or customers. Describe account growth as account growth; member growth needs its own same-institution, same-period member-count evidence.
- NCUA dividends on shares are reported year-to-date expense, not evidence of cash paid. Keep the expense label even when the question says "paid".
- State period limits as observations, not advice: "This is a six-month total; no full-year estimate is established." Do not tell the reader that they "should" or "should not" annualize it.
- A current fee schedule is a price, not realized revenue or a historical record of prices, waivers, refunds or charged items. A $0 overdraft price cannot establish zero overdraft income or zero paying members in a prior period. Broad fee income cannot identify either figure; say unavailable unless a dedicated reported line answers it.
- Broad NCUA fee income includes overdraft fees among other member-service and membership fees. Say "not overdraft-only income" or "overdraft income cannot be isolated from this total"; never say this broad line is not overdraft income or excludes overdraft fees. Retain the qualifier in every section, including summary bullets; a later precise definition does not repair an earlier exclusion.
- A cross-sectional peer median describes the filers for that date. Do not call changes between separately selected quarterly peer populations growth, outperformance, keeping pace or falling behind. Identical charter IDs do not establish an unchanged economic perimeter or merger adjustment. Current historical tools establish dated cross-sections only; retain exact reporter lists, coverage and lifecycle uncertainty. You may report each dated median and its coverage, including correctly labeled year-to-date figures. Never relabel YTD as a standalone quarter or broad NCUA income as FDIC deposit service charges.
- Do not invent a reason for an unqueried peer filter. A nationwide sample does not establish that a Fed-district group would be too small. Read the exact district and otherwise matching group first, or say its coverage has not been checked.
- A missing, unreported or unusable overdraft figure in the available evidence does not establish that NCUA's filing has no overdraft line or field. Describe the evidence's missing usable figure; do not infer absence from the publisher's schema.
- For an explicit quarter-only question, answer that standalone quarter or say plainly that the requested comparison cannot be computed. A correctly labeled year-to-date figure is related context, not an answer to Q2. Never subtract separately rolled peer medians: quarter medians require matched per-institution quarter differences before aggregation.
- A broad size band and nearest-in-assets peers are different legitimate cohort definitions. State which was used, its criteria, reported count and selected-subject inclusion. Never call one the only true or only valid peer group, or attribute a dollar-income gap, lead or ranking to size rather than pricing without causal evidence. A dollar lead does not establish that it reflects size, comes from scale, or is explained by assets. Use neutral observations: "The institution leads this cohort in reported fee-income dollars; these figures do not establish whether size, pricing or member volume explains the lead."
- All eligible financial filers reporting establishes completeness for that dated cohort, not a strong, reliable, robust or representative benchmark. State the eligible/reported counts and limitations; do not apply fee-price sample-maturity labels to financial filing comparisons or infer benchmark quality from coverage alone.
- Do not state a peer-income multiple (times, x or ×) unless the server's validated calculation ledger supplies that cohort-specific ratio. Report the two sourced totals instead.
- Correlations, similar peer growth and fee-income totals do not identify a pricing or market cause. Do not conclude that pricing, the market or a zero-fee stance caused revenue, or rank a funding-cost change against an unmeasured fee-schedule change. Describe observed figures and the evidence missing to explain them.
- Preserve missing overdraft income and payer counts as unavailable. Do not fill the gap with zero, a schedule price, account counts or a revenue/price quotient. Clearly separate a question for further research from a finding.`;

type RecordValue = Record<string, unknown>;
interface Observation {
  metric: string;
  institutionId: string | null;
  institutionName: string | null;
  period: string;
  unit: string;
  value: number;
}
interface PeerScope {
  districts: number[];
  fingerprint: string;
}
interface PeerCoverage extends PeerScope {
  period: string;
  count: number;
  memberCount: number | null;
}
interface Evidence {
  ncua: boolean;
  incomplete: boolean;
  observations: Observation[];
  accountDates: Map<string, Set<string>>;
  dividendExpense: boolean;
  selectedIds: Set<string>;
  selectedId: string | null;
  peerCoverage: PeerCoverage[];
  quarterIncomes: { institutionId: string | null; period: string; value: number; role: "subject" | "peer_median" }[];
  peerMultipliers: { period: string; value: number }[];
  quarterCalculations: { institutionId: string; period: string; value: number; inputs: [number, number] }[];
  canonicalSources: Map<string, Set<"fdic" | "ncua">>;
  broadIncomeIds: Set<string>;
  financialPeerComparison: boolean;
}

const record = (v: unknown): RecordValue | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as RecordValue : null;
const finite = (v: unknown): number | null => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) && Number.isFinite(Number(v)) ? Number(v) : null;
const textValue = (v: unknown): string | null => typeof v === "string" && v.trim() ? v : null;
const ncuaSource = (r: RecordValue): boolean => /\bncua\b/i.test(String(r.source ?? "")) || /\bNCUA\b/i.test(String(r.publisher ?? ""));

function evidenceFrom(data: unknown): Evidence {
  const result: Evidence = { ncua: false, incomplete: false, observations: [], accountDates: new Map(), dividendExpense: false, selectedIds: new Set(), selectedId: null, peerCoverage: [], quarterIncomes: [], peerMultipliers: [], quarterCalculations: [], canonicalSources: new Map(), broadIncomeIds: new Set(), financialPeerComparison: false };
  const root = record(data);
  // This collection is reconstructed only from the server's observed filing-peer
  // reads and selected institution, never arbitrary tool-output-shaped comparisons.
  if (Array.isArray(root?.validated_filed_peer_income)) for (const value of root.validated_filed_peer_income) {
    const income = record(value);
    if (!income || (income.source !== "ncua" && income.source !== "fdic") || !Number.isSafeInteger(income.institution_id)
      || (root?.selected_institution_id !== null && income.institution_id !== root?.selected_institution_id) || typeof income.report_date !== "string"
      || finite(income.subject_income_usd) === null) continue;
    const id = String(income.institution_id);
    const sources = result.canonicalSources.get(id) ?? new Set<"fdic" | "ncua">();
    sources.add(income.source);
    result.canonicalSources.set(id, sources);
    result.financialPeerComparison = true;
    if (income.source !== "ncua") continue;
    result.ncua = true;
    result.broadIncomeIds.add(id);
    result.quarterIncomes.push({ institutionId: id, period: income.report_date, value: Number(income.subject_income_usd), role: "subject" });
    if (finite(income.peer_median_income_usd) !== null && Number(income.peer_count) >= Number(income.minimum_median_count)) {
      result.quarterIncomes.push({ institutionId: id, period: income.report_date, value: Number(income.peer_median_income_usd), role: "peer_median" });
    }
  }
  // Only server-computed candidates, never a tool's arbitrary ratio-like numeric fields.
  if (Array.isArray(root?.validated_calculations)) for (const value of root.validated_calculations.slice(0, 40)) {
    const calculation = record(value);
    if (calculation?.source === "ncua" && calculation.metric === "fee_income_peer_multiple" && calculation.operation === "ratio"
      && calculation.unit === "multiple" && typeof calculation.report_date === "string" && finite(calculation.value) !== null) {
      result.peerMultipliers.push({ period: calculation.report_date, value: Number(calculation.value) });
    }
    if (calculation?.source === "ncua" && calculation.operation === "ytd_to_quarter" && ["call:acct_131", "broad_credit_union_fee_income"].includes(String(calculation.measure))
      && calculation.period_basis === "standalone_quarter" && calculation.unit === "USD" && typeof calculation.report_date === "string"
      && finite(calculation.institution_id) !== null && finite(calculation.value) !== null && typeof calculation.expression === "string") {
      const subtraction = /^\((\d+(?:\.\d+)?) - (\d+(?:\.\d+)?)\)$/.exec(calculation.expression);
      if (subtraction && Number(subtraction[1]) - Number(subtraction[2]) === Number(calculation.value)) {
        result.quarterCalculations.push({ institutionId: String(calculation.institution_id), period: calculation.report_date,
          value: Number(calculation.value), inputs: [Number(subtraction[1]), Number(subtraction[2])] });
      }
    }
  }
  let visited = 0;
  const seen = new WeakSet<object>();
  function visit(value: unknown, depth: number, scopeId: string | null = null, peerScope: PeerScope | null = null): void {
    if (++visited > 5000 || depth > 16) { result.incomplete = true; return; }
    if (typeof value === "string") {
      if (/^[\s]*[\[{]/.test(value)) {
        if (value.length > 1_000_000) { result.incomplete = true; return; }
        try { visit(JSON.parse(value), depth + 1, scopeId, peerScope); } catch { /* Prose is not evidence. */ }
      }
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { for (const child of value) visit(child, depth + 1, scopeId, peerScope); return; }
    const r = value as RecordValue;
    if (finite(r.selected_institution_id) !== null && Number(r.selected_institution_id) > 0) result.selectedId = String(r.selected_institution_id);
    const input = record(r.input);
    const scope = record(input?.scope);
    const id = scope?.kind === "institution" && scope.id != null ? String(scope.id)
      : r.toolName === "getInstitution" && finite(input?.id) !== null ? String(input?.id) : scopeId;
    if (r.toolName === "getInstitution" && id) {
      const profile = record(r.output);
      const identity = record(profile?.identity);
      const source = financialSourceForCharter(identity?.charter_type);
      const comparison = record(record(profile?.peer_ranking)?.comparison);
      const definition = record(record(profile?.financials)?.definition);
      if (source && String(identity?.id) === id && ((validFinancialPeerComparison(comparison) && comparison.source === source)
        || (definition?.source === source && definition.charter_type === identity?.charter_type))) {
        const sources = result.canonicalSources.get(id) ?? new Set<"fdic" | "ncua">();
        sources.add(source);
        result.canonicalSources.set(id, sources);
        if (source === "ncua" && (definition?.measure === "broad_credit_union_fee_income"
          || comparison?.measure === "broad_credit_union_fee_income")) result.broadIncomeIds.add(id);
      }
    }
    let currentPeer = peerScope;
    if (scope?.kind === "peer_set") {
      const peer = record(scope.peer) ?? {};
      const districts = Array.isArray(peer.fed_districts) ? peer.fed_districts.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12) : [];
      const otherFilters = Object.fromEntries(Object.keys(peer).filter((key) => key !== "fed_districts").sort()
        .map((key) => [key, Array.isArray(peer[key]) ? [...peer[key] as unknown[]].sort() : peer[key]]));
      currentPeer = { districts, fingerprint: JSON.stringify({ id: scope.id == null ? null : String(scope.id), measure: input?.measure, peer: otherFilters }) };
    }
    if (ncuaSource(r)) result.ncua = true;
    const comparison = record(r.comparison);
    if (validFinancialPeerComparison(comparison)) result.financialPeerComparison = true;
    if (validFinancialPeerComparison(comparison) && comparison.source === "ncua") {
      const scale = comparison.unit === "thousands of dollars" ? 1000 : 1;
      if (finite(r.sc_income) !== null) result.quarterIncomes.push({ institutionId: id, period: comparison.report_date, value: Number(r.sc_income) * scale, role: "subject" });
      if (comparison.reported_count >= comparison.minimum_median_count && finite(r.peer_median_sc) !== null) result.quarterIncomes.push({ institutionId: id, period: comparison.report_date, value: Number(r.peer_median_sc) * scale, role: "peer_median" });
    }
    const trendDefinition = record(r.revenue_trend_definition);
    if (trendDefinition?.source === "ncua" && trendDefinition.period_basis === "standalone_quarter" && trendDefinition.unit === "thousands of dollars" && Array.isArray(r.revenue_trend)) {
      for (const raw of r.revenue_trend) {
        const quarter = record(raw);
        const match = typeof quarter?.quarter === "string" ? quarter.quarter.match(/^(20\d{2})-?Q([1-4])$/) : null;
        if (match && finite(quarter?.service_charge_income) !== null) result.quarterIncomes.push({ institutionId: id,
          period: `${match[1]}-${["03-31", "06-30", "09-30", "12-31"][Number(match[2]) - 1]}`, value: Number(quarter?.service_charge_income) * 1000, role: "subject" });
      }
    }
    if (ncuaSource(r) && r.period_basis === "standalone_quarter" && r.unit === "USD"
      && (r.operation === "ytd_to_quarter" || r.operation === "q1_ytd_as_quarter")
      && (r.measure === "call:acct_131" || r.measure === "broad_credit_union_fee_income" || r.metric === "acct_131" || r.metric === "service_charge_income")
      && finite(r.value) !== null && typeof r.report_date === "string") {
      result.quarterIncomes.push({ institutionId: r.institution_id == null ? id : String(r.institution_id), period: r.report_date, value: Number(r.value), role: "subject" });
    }
    const metadata = record(r.measure_metadata);
    // Captions identify a measure's limitations, even when its value is missing.
    // They never supply an observation or authorize a reported fact.
    if (ncuaSource(r) || (metadata && ncuaSource(metadata))) {
      if (r.measure === "call:acct_380" || r.metric === "acct_380") result.dividendExpense = true;
    }
    // Only a successful query with rows can establish a measure. listData captions
    // and peer member_count (number of institutions) cannot establish member counts.
    if (r.ok === true && typeof r.measure === "string" && Array.isArray(r.rows) && metadata && ncuaSource(metadata)) {
      const metric = r.measure.replace(/^call:/, "");
      if (r.scope === "institution" && metric === "acct_131" && id) result.broadIncomeIds.add(id);
      for (const value of r.rows) {
        const row = record(value);
        const period = textValue(row?.period);
        if (!row || !period) continue;
        const count = finite(row.institution_count);
        if (r.scope === "peer_set" && currentPeer && count !== null && count >= 0) {
          result.peerCoverage.push({ ...currentPeer, period, count, memberCount: finite(row.member_count) });
        }
        const number = finite(row.value);
        if (r.scope !== "institution" || number === null) continue;
        const unit = String(row.unit ?? metadata.unit ?? r.unit ?? "");
        result.observations.push({ metric, institutionId: id, institutionName: null, period, unit, value: number });
        if (metric === "acct_452" && unit === "count" && id) {
          const dates = result.accountDates.get(id) ?? new Set<string>();
          dates.add(period); result.accountDates.set(id, dates);
        }
        if (metric === "acct_380" && unit === "USD" && row.period_basis === "ytd") result.dividendExpense = true;
      }
    }
    // Canonical briefing facts are separate from query roll-ups. Require explicit
    // institution, reporting date, source and unit; no arbitrary nested member_count.
    if (typeof r.metric === "string" && r.institution_id != null && ncuaSource(r)) {
      const period = textValue(r.report_date);
      const number = finite(r.value);
      if (period && number !== null) {
        result.observations.push({
          metric: r.metric, institutionId: String(r.institution_id), institutionName: textValue(r.institution_name),
          period, unit: String(r.unit ?? ""), value: number,
        });
        if (["research", "account_evidence"].includes(String(r.context_role))) result.selectedIds.add(String(r.institution_id));
      }
    }
    for (const child of Object.values(r)) visit(child, depth + 1, id, currentPeer);
  }
  visit(data, 0);
  return result;
}

const MONTH_NUMBERS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
/** Month precision stays month precision; an explicitly stated day must also match. */
function claimedPeriods(clause: string): string[] {
  const periods: { period: string; index: number }[] = [...clause.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)].map((m) => ({ period: m[0], index: m.index! }));
  const years = [...new Set(clause.match(/\b20\d{2}\b/g) ?? [])];
  const months = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b(?:\s+(?:(\d{1,2}),?\s+)?(20\d{2}))?/gi;
  for (const m of clause.matchAll(months)) {
    const year = m[3] ?? (years.length === 1 ? years[0] : null);
    periods.push({ period: year ? `${year}-${MONTH_NUMBERS[m[1].slice(0, 3).toLowerCase()]}${m[2] ? `-${m[2].padStart(2, "0")}` : ""}` : "unresolved-month", index: m.index! });
  }
  for (const m of clause.matchAll(/\bQ([1-4])\s*[,/-]?\s*(20\d{2})\b/gi)) periods.push({ period: `${m[2]}-${["03", "06", "09", "12"][Number(m[1]) - 1]}`, index: m.index! });
  return [...new Set(periods.sort((a, b) => a.index - b.index).map((entry) => entry.period))];
}

/** A dedicated line may answer the question; a price or another subject's line cannot. */
function reportedLineSupports(clause: string, evidence: Evidence, metrics: readonly string[], unit: string, zero: boolean): boolean {
  const periods = claimedPeriods(clause);
  if (periods.length !== 1 || periods[0] === "unresolved-month") return false;
  const claimedPeriod = periods[0];
  const subjectIds = evidence.selectedId ? new Set([evidence.selectedId])
    : evidence.selectedIds.size ? evidence.selectedIds : new Set(evidence.accountDates.keys());
  if (subjectIds.size !== 1) return false;
  const payerMatch = clause.match(/\b(no|zero|\d[\d,]*)\s+(?:members?|customers?|payers?)\b/i)
    ?? clause.match(/\b(?:payers?|paying members?)\s*(?:count|number)?\s*(?:was|were|is|are|:)\s*(zero|none|\d[\d,]*)\b/i);
  const nobody = /\b(?:nobody|no[ -]?one|not a single (?:member|customer|payer)|none of (?:the |its |their )?(?:members|customers|payers))\b/i.test(clause);
  const payerValue = payerMatch ? /^(?:no|zero|none)$/i.test(payerMatch[1]) ? 0 : Number(payerMatch[1].replace(/,/g, "")) : nobody ? 0 : null;
  return evidence.observations.some((o) => metrics.includes(o.metric) && o.institutionId !== null && subjectIds.has(o.institutionId)
    && o.unit === unit && o.period.startsWith(claimedPeriod) && (zero ? o.value === 0 : payerValue !== null && o.value === payerValue));
}

function memberGrowthSupported(clause: string, evidence: Evidence): boolean {
  // A real member-count series is allowed, but a value for another institution,
  // an unrelated reporting window, a peer-population count or dollar unit is not.
  const contexts = new Map(evidence.accountDates);
  if (contexts.size === 0 && evidence.selectedIds.size === 1) {
    for (const id of evidence.selectedIds) contexts.set(id, new Set(evidence.observations.filter((o) => o.metric === "member_count" && o.institutionId === id && o.unit === "count").map((o) => o.period)));
  }
  for (const [id, dates] of contexts) {
    if (evidence.selectedId && id !== evidence.selectedId) continue;
    const sortedDates = [...dates].sort();
    const members = evidence.observations.filter((o) => o.metric === "member_count" && o.institutionId === id && o.unit === "count");
    const claimed = claimedPeriods(clause);
    let interval: string[];
    if (claimed.length === 2) {
      // An explicit subinterval may sit inside a longer available history. Select
      // its own endpoints from the member series, never the full-window extrema.
      const memberDates = [...new Set(members.map((o) => o.period))];
      const endpoints = claimed.map((period) => memberDates.filter((date) => date.startsWith(period)));
      if (endpoints.some((matches) => matches.length !== 1)) continue;
      interval = endpoints.map((matches) => matches[0]);
    } else {
      // Without two stated endpoints, only a clearly selected two-date window
      // establishes the comparison. Extra periods must not choose the trend.
      if (claimed.length > 2 || sortedDates.length !== 2) continue;
      interval = sortedDates;
    }
    const [first, last] = interval;
    if (first >= last) continue;
    const at = (period: string) => {
      const matches = members.filter((o) => o.period === period);
      return new Set(matches.map((o) => o.value)).size === 1 ? matches[0] : undefined;
    };
    const earlier = at(first);
    const latest = at(last);
    if (!earlier || !latest) continue;
    const years = clause.match(/\b20\d{2}\b/g) ?? [];
    if (years.some((year) => ![first.slice(0, 4), last.slice(0, 4)].includes(year))) continue;
    if (claimed.some((period) => ![first, last].some((date) => date.startsWith(period)))) continue;
    const otherNames = evidence.observations.filter((o) => o.institutionId !== id && o.institutionName).map((o) => o.institutionName!);
    if (otherNames.some((name) => clause.toLowerCase().includes(name.toLowerCase()))) continue;
    if (/\b(?:fell|falling|declin\w*|decreas\w*|shrank|shrinking)\b/i.test(clause)) return latest.value < earlier.value;
    return latest.value > earlier.value;
  }
  return false;
}

function districtSizeSupported(clause: string, evidence: Evidence): boolean {
  const districts = [...new Set([...clause.matchAll(/\bdistrict\s+(\d{1,2})\b/gi)].map((m) => Number(m[1])))];
  if (districts.length !== 1) return false;
  const claimed = claimedPeriods(clause);
  if (claimed.length > 1 || claimed.includes("unresolved-month")) return false;
  return evidence.peerCoverage.some((coverage) => {
    if (coverage.districts.length !== 1 || coverage.districts[0] !== districts[0] || coverage.count >= MIN_PEERS_FOR_POSITION) return false;
    // A group with many members and few reported figures supports a limited
    // filing sample, rather than a claim that the group itself is too small.
    const sampleClaim = /\b(?:reported|filing|filed|usable|filers?|sample)\b/i.test(clause);
    if (!sampleClaim && (coverage.memberCount === null || coverage.memberCount >= MIN_PEERS_FOR_POSITION)) return false;
    const baseline = evidence.peerCoverage.filter((other) => other.districts.length === 0 && other.fingerprint === coverage.fingerprint);
    const latest = baseline.map((other) => other.period).sort().at(-1);
    return latest !== undefined && (claimed.length === 1 ? coverage.period.startsWith(claimed[0]) : coverage.period === latest);
  });
}

/** An epistemic withdrawal must govern this assertion. An unrelated "Unavailable"
 * label or an unavailable result followed by "because" cannot excuse its reason. */
function explicitlyWithdrawn(clause: string, assertion: RegExpMatchArray): boolean {
  const index = assertion.index ?? 0;
  const before = clause.slice(Math.max(0, index - 160), index);
  const after = clause.slice(index + assertion[0].length);
  const epistemicPrefix = /\b(?:cannot|can't|do not|don't|does not|doesn't)\s+(?:infer|conclude|establish|prove|determine|show|know|say)\b(?:\s+(?:whether|if|that|from|the|a|an|missing|available|reported|figures?|values?|data|evidence)){0,12}\s*$/i;
  const uncertainPrefix = /\b(?:unknown|not (?:known|established|determined|checked))\s+(?:whether|if|that)\s+(?:the\s+)?$|\bno (?:evidence|data)\s+(?:shows?|establishes?|proves?)\s+that\s+(?:the\s+)?$|\bnot evidence that\s+(?:(?:size|scale)\s+or\s+)?(?:the\s+)?$/i;
  const withdrawnSuffix = /^\s*["'”’]?\s*(?:(?:is|was|remains)\s+(?:not (?:established|known|determined|shown)|unproven|unsupported)|(?:cannot|can't)\s+be\s+(?:established|shown|determined|inferred))\b/i;
  return epistemicPrefix.test(before) || uncertainPrefix.test(before) || withdrawnSuffix.test(after);
}

/** Negations apply to the claim's clause, never to an entire answer. */
function refuses(clause: string, topic: RegExp): boolean {
  const refusal = /\b(?:cannot|can't|does not|do not|did not|doesn't|don't|didn't|is not|isn't|are not|aren't|not enough(?: (?:data|evidence|information))? to|insufficient(?: (?:data|evidence|information))? to|no basis to)\s+(?:\w+[ -]){0,5}(?:infer|establish|show|prove|determine|identify|conclude|mean|imply|tell|say|reveal|attribute|evidence|measure|known|available|reported|supported)|\b(?:unavailable|unknown|unreported|not (?:established|reported|available|shown|known|measured|supported))\b/i;
  const absentLine = /\bno\s+(?:overdraft\s+)?(?:income|revenue|payer counts?)(?:\s+from\s+overdrafts?)?\s+(?:is|was|has been)\s+(?:reported\b|available\b.{0,35}\b(?:data|filings?|sources?))\b/i;
  return (refusal.test(clause) || absentLine.test(clause)) && topic.test(clause);
}

function requestedIncomeQuarter(question: string | undefined): { year: string; quarter: number; period: string } | null {
  if (!question || !/\b(?:fee|service[ -]charge)\s+(?:income|revenue)\b/i.test(question)) return null;
  const quarter = question.match(/\bQ([1-4])\s*[,/-]?\s*(20\d{2})\b/i)
    ?? question.match(/\b(first|second|third|fourth)\s+quarter(?:\s+of)?\s+(20\d{2})\b/i);
  const aprilJune = question.match(/\bApril\s*(?:through|to|[-–—])\s*June\s+(20\d{2})\b/i);
  if (!quarter && !aprilJune) return null;
  if (/\b(?:year[ -]to[ -]date|YTD|first six months|half[ -]year)\b/i.test(question)
    && !/\b(?:alone|standalone|during|rather than)\b/i.test(question) && !aprilJune) return null;
  const index = quarter ? Number(quarter[1]) || ["first", "second", "third", "fourth"].indexOf(quarter[1].toLowerCase()) + 1 : 2;
  const year = quarter?.[2] ?? aprilJune![1];
  return { year, quarter: index, period: `${year}-${["03-31", "06-30", "09-30", "12-31"][index - 1]}` };
}

function quarterQuestionProblems(text: string, question: string | undefined, evidence: Evidence): string[] {
  const requested = requestedIncomeQuarter(question);
  if (!requested || requested.quarter === 1) return []; // Q1 YTD and its standalone quarter cover the same months.
  const selectedSources = evidence.selectedId ? evidence.canonicalSources.get(evidence.selectedId)
    : evidence.canonicalSources.size === 1 ? evidence.canonicalSources.values().next().value : undefined;
  // Ancillary NCUA definitions do not turn the selected bank's already-quarterly
  // FDIC income into a credit-union YTD conversion problem. Conflicts fail closed.
  if (selectedSources?.size === 1 && selectedSources.has("fdic")) return [];
  const primary = text.split(/^##?\s+Explore Further\b/im)[0];
  const clauses = primary.split(/\r?\n+|(?<=[.!?])\s+|;\s*/).map((clause) => clause.replace(/^\s*[-*#]+\s*/, "").trim());
  const quarterReference = /\bQ[1-4]\b|\b(?:first|second|third|fourth)[ -]quarter\b|\b(?:standalone[ -]quarter|quarter[ -]only)\b/i;
  const window = /\bApril\s*(?:through|to|[-–—])\s*June\b/i;
  const namesQuarter = (clause: string) => quarterReference.test(clause) || window.test(clause);
  const refusal = (clause: string) => namesQuarter(clause) && /\b(?:cannot|can't|unable to|not enough|insufficient|unavailable|not available)\b/i.test(clause)
    && /\b(?:comput\w*|calculat\w*|compar\w*|income|revenue|figure|median)\b/i.test(clause);
  const clearRefusal = clauses.some(refusal);
  const failure = "The question asks for standalone-quarter fee income. Answer that quarter from matched institution-quarter calculations or the dated comparable-quarter tool, or clearly state that the requested quarter comparison cannot be computed; a YTD substitute does not answer it.";
  let answeredRequestedQuarter = false;
  const validatedClaims: { institutionId: string | null; period: string; value: number; tolerance: number; clause: string }[] = [];
  const operandExplanations: { calculations: Evidence["quarterCalculations"]; clause?: string }[] = [];
  for (const clause of clauses) {
    if (clause.endsWith("?")) continue;
    const explicitQuarter = namesQuarter(clause);
    const feePrice = /\b(?:fee[ -]schedule|published\s+(?:fee|price)|fee\s+price|prices?|overdraft|NSF|ATM|wire|monthly maintenance)\b/i.test(clause);
    const explicitIncome = /\b(?:fee|service[ -]charge)\s+(?:income|revenue)\b/i.test(clause);
    const peerMedian = /\b(?:peer(?:s|'s|s')?|cohort|group|benchmark)\s+(?:(?:fee[ -])?income\s+)?median\b/i.test(clause)
      && (!feePrice || explicitIncome);
    const ytd = /\b(?:year[ -]to[ -]date|YTD|half[ -]year|six months)\b/i.test(clause);
    if ((!explicitQuarter && !peerMedian) || (!explicitQuarter && ytd)) continue;
    const allFigures = extractFigures(clause);
    const assetBounds = tierBoundsAsSize(clause, allFigures);
    // Size criteria exempt only their actual bounds, never income claims in the same sentence.
    const quoted = allFigures.filter((figure) => figure.kind === "usd" && !figure.denominatorUnit && !assetBounds.has(figure));
    if (quoted.length === 0) continue;
    const periods = claimedPeriods(clause).filter((period) => /^20\d{2}-(?:03|06|09|12)(?:-\d{2})?$/.test(period))
      .map((period) => period.length === 7 ? `${period}-${["03", "12"].includes(period.slice(5)) ? "31" : "30"}` : period);
    const dates = periods.length ? periods : [requested.period];
    const calculationInputs = new Set<(typeof quoted)[number]>();
    if (quoted.length === 2 && evidence.selectedId) {
      const [current, prior] = quoted;
      const label = /^(?:(?:the|this)\s+)?(?:(?:standalone\s+)?Q([1-4])(?:\s+(20\d{2}))?(?:\s+quarter)?|(?:standalone\s+)?quarter)\s+(?:is|equals?)\s*$/i.exec(clause.slice(0, current.index));
      const connector = clause.slice(current.index + current.raw.length, prior.index);
      const priorLabel = /^\s*for\s+Q([1-4])(?:\s+(20\d{2}))?(?:\s+(YTD|year[ -]to[ -]date))?\s*(?:\(NCUA(?:\s+5300)?\s+call report\))?\s*[.!]?\s*$/i.exec(clause.slice(prior.index + prior.raw.length));
      if (label && (!label[1] || Number(label[1]) === requested.quarter) && (!label[2] || label[2] === requested.year)
        && /^\s*(?:YTD|year[ -]to[ -]date)\s*(?:minus|−|-)\s*$/i.test(connector)
        && priorLabel && Number(priorLabel[1]) === requested.quarter - 1 && (!priorLabel[2] || priorLabel[2] === requested.year)
        && (priorLabel[1] === "1" || priorLabel[3])) {
        const calculations = evidence.quarterCalculations.filter((calculation) => calculation.institutionId === evidence.selectedId
          && calculation.period === requested.period && dates.includes(calculation.period)
          && Math.abs(calculation.inputs[0] - current.value) <= current.tolerance
          && Math.abs(calculation.inputs[1] - prior.value) <= prior.tolerance);
        if (calculations.length) {
          calculationInputs.add(current); calculationInputs.add(prior);
          operandExplanations.push({ calculations });
        }
      }
    }
    const matchingCalculations = (value: (typeof quoted)[number], first: (typeof quoted)[number], second: (typeof quoted)[number]) =>
      evidence.quarterCalculations.filter((calculation) => dates.includes(calculation.period)
        && (!evidence.selectedId || calculation.institutionId === evidence.selectedId)
        && Math.abs(calculation.value - value.value) <= value.tolerance
        && Math.abs(calculation.inputs[0] - first.value) <= first.tolerance
        && Math.abs(calculation.inputs[1] - second.value) <= second.tolerance);
    const citationTail = /^\s*(?:\(Source:\s*NCUA(?:\s*\(5300 call report\))?,\s*20\d{2}-\d{2}-\d{2}\))?\s*[.!]?\s*$/i;
    for (let index = 0; index + 2 < quoted.length; index++) {
      const [value, first, second] = quoted.slice(index, index + 3);
      const introduction = clause.slice(value.index + value.raw.length, first.index);
      const subtraction = clause.slice(first.index + first.raw.length, second.index);
      const finalInputLabel = clause.slice(second.index + second.raw.length);
      if (/^\s*,?\s*(?:=|(?:calculated|computed) as)\s*\(?\s*$/i.test(introduction)
        && /^\s*(?:YTD|year[ -]to[ -]date)\s*(?:minus|−|-)\s*$/i.test(subtraction)
        && /^\s*(?:YTD|year[ -]to[ -]date)\s*\)?/i.test(finalInputLabel)
        && citationTail.test(finalInputLabel.replace(/^\s*(?:YTD|year[ -]to[ -]date)\s*\)?/i, ""))
        && matchingCalculations(value, first, second).length) {
        calculationInputs.add(first); calculationInputs.add(second);
      }
      // Result-last wording still needs the same typed calculation. Q1 totals
      // equal Q1 YTD; later prior quarters must explicitly retain a YTD label.
      const [current, prior, result] = quoted.slice(index, index + 3);
      const currentLabel = clause.slice(0, current.index);
      const priorLabel = clause.slice(current.index + current.raw.length, prior.index);
      const priorQuarter = /^\s*(?:minus|−|-)\s+(?:(?:its|the)\s+)?(?:Q([1-4])|(first|second|third|fourth)[ -]quarter)\s+(?:(YTD|year[ -]to[ -]date)\s+)?(?:total|fee income)(?:\s+of)?\s*$/i.exec(priorLabel);
      const priorNumber = priorQuarter ? Number(priorQuarter[1]) || ["first", "second", "third", "fourth"].indexOf((priorQuarter[2] ?? "").toLowerCase()) + 1 : 0;
      const sixMonth = /\bsix[ -]month\s+total\s+of\s*$/i.test(currentLabel);
      const currentIsYtd = /\b(?:YTD|year[ -]to[ -]date)\s+(?:total|fee income)(?:\s+of)?\s*$/i.test(currentLabel)
        || (requested.quarter === 2 && sixMonth);
      const calculations = matchingCalculations(result, current, prior).filter((calculation) => Number(calculation.period.slice(5, 7)) / 3 - 1 === priorNumber);
      if (currentIsYtd && priorQuarter && (priorNumber === 1 || priorQuarter[3])
        && /^\s*(?:equals?|=|,\s*which gives)\s*$/i.test(clause.slice(prior.index + prior.raw.length, result.index))
        && citationTail.test(clause.slice(result.index + result.raw.length)) && calculations.length) {
        calculationInputs.add(current); calculationInputs.add(prior);
        if (sixMonth) operandExplanations.push({ calculations, clause });
      }
    }
    // Only operands of the server's exact YTD subtraction are contextual input figures.
    // Comparative wording such as "less than" never exempts another quarter assertion.
    const figures = quoted.filter((figure) => !calculationInputs.has(figure));
    for (const [index, figure] of figures.entries()) {
      const previous = figures[index - 1];
      // A peer label governs its own amount. It cannot cross an earlier figure or
      // a new assertion such as "and Navy Federal fee income was ...".
      const before = clause.slice(previous ? previous.index + previous.raw.length : 0, figure.index)
        .split(/\b(?:vs|versus|while|against|compared with|and|but)\b/i).at(-1) ?? "";
      const after = clause.slice(figure.index + figure.raw.length, figure.index + figure.raw.length + 20);
      const role = /\b(?:peer|median)\b/i.test(before) || /^\s*(?:peer\s+)?median\b/i.test(after) ? "peer_median" : "subject";
      const matches = evidence.quarterIncomes.filter((income) => income.role === role && dates.includes(income.period)
        && (!evidence.selectedId || income.institutionId === evidence.selectedId)
        && Math.abs(income.value - figure.value) <= figure.tolerance);
      // A refusal in another sentence never excuses an affirmative quarter-dollar claim.
      if (matches.length === 0) return [failure];
      if (role === "subject") for (const income of matches) validatedClaims.push({
        institutionId: income.institutionId, period: income.period, value: figure.value, tolerance: figure.tolerance, clause,
      });
      if (role === "subject" && matches.some((income) => income.period === requested.period) && !refusal(clause)) answeredRequestedQuarter = true;
    }
  }
  // An operand-only explanation never supplies the answer itself: its matching
  // selected-institution quarter result must also have passed elsewhere.
  if (operandExplanations.some((explanation) => !explanation.calculations.some((calculation) => validatedClaims.some((claim) =>
    claim.clause !== explanation.clause && claim.institutionId === calculation.institutionId && claim.period === calculation.period
      && Math.abs(claim.value - calculation.value) <= claim.tolerance)))) return [failure];
  return answeredRequestedQuarter || clearRefusal ? [] : [failure];
}

/** A withdrawal governs its own assertion; an earlier disclaimer never excuses a later claim. */
function historicalAssertionWithdrawn(clause: string, assertion: RegExpMatchArray): boolean {
  const before = clause.slice(0, assertion.index);
  const after = clause.slice((assertion.index ?? 0) + assertion[0].length);
  const coordinated = /\bnot\s+(?:(?:a|an|the)\s+)?(?:constant[ -]cohort|merger[ -]adjusted)(?:\s*(?:,|or|and)\s*(?:constant[ -]cohort|merger[ -]adjusted))*\s*(?:,|or|and)\s*$/i.test(before);
  const uncertainAlternatives = /\b(?:cannot|can't|do not|don't|does not|doesn't)\s+(?:infer|conclude|establish|prove|determine|show|know|say|tell)\s+(?:whether|if|how)\s+(?:size|scale|assets?|pricing|prices?|market|member volume|volume)(?:\s*(?:,|or|and)\s*(?:size|scale|assets?|pricing|prices?|market|member volume|volume))*\s*(?:,|or|and)\s*$/i.test(before);
  const tail = after.replace(/^\s*(?:(?:,|or|and)\s*(?:constant[ -]cohort|merger[ -]adjusted)\s*)*/i, "");
  return explicitlyWithdrawn(clause, assertion)
    || coordinated
    || uncertainAlternatives
    || /\b(?:not|never)\s+(?:(?:a|an|the)\s+)?$/i.test(before)
    || /^\s*(?:do not|don't|does not|doesn't)\s+(?:establish|show|prove|imply|mean)\b/i.test(after)
    || /^\s*(?:(?:growth|comparison|trend|series|benchmark|claim|result|cohort)\s+){0,3}(?:(?:(?:is|was|remains?)\s+)?(?:unavailable|unknown|not (?:established|supported|known))\b|(?:cannot|can't)\s+be\s+(?:concluded|established|determined|inferred)\b)/i.test(tail)
    || /\bno\s+(?:causal\s+)?(?:evidence|basis)\s+(?:(?:shows?|establishes?|proves?|that|the)\s+)*$/i.test(before);
}

function historicalPeerProblems(text: string, data: unknown, evidence: Evidence): string[] {
  const history = record(record(data)?.validated_call_peer_history);
  if (!evidence.ncua && !evidence.financialPeerComparison && history?.observed !== true) return [];
  const problems = new Set<string>();
  if (history?.invalid === true) problems.add("The observed call-report peer history has inconsistent source, measure, unit or period-basis metadata. Refresh the read before presenting this comparison.");
  const observations = Array.isArray(history?.observations) ? history.observations.map(record).filter((value): value is RecordValue => value !== null) : [];
  const clauses = text.split(/\r?\n+|(?<=[.!?])\s+|;\s*|,\s*(?:but|yet|however|therefore|thus|so)\s+|\s+(?:but|however|therefore|thus)\s+|\s+and\s+(?=(?:its?|their|the|NCUA|FDIC|FFIEC|\w+'s)\s+)/i);
  for (const raw of clauses) {
    const clause = raw.replace(/^\s*[-*#]+\s*/, "").trim();
    if (!clause.trim() || (/^\s*(?:how|what|which|could|can|would|does|do)\b/i.test(clause) && clause.endsWith("?"))) continue;
    if (/\b(?:posted|published|schedule|fee[ -]price)\b/i.test(clause) && !/\b(?:income|revenue|financial|filers?|filings?|call reports?)\b/i.test(clause)) continue;
    const topic = /\b(?:peers?|cohort|group|benchmark|median|reporting population)\b/i;
    const trend = /(?<![\w-])\b(?:peers?(?:'s|s')?|(?:constant[ -])?cohort|group|benchmark|(?:fee[ -]income\s+)?median|reporting population)\b.{0,85}\b(?:grew|grow\w*|rose|increas\w*|decreas\w*|fell|declin\w*|outperform\w*|pace|pulling\s+(?:further\s+)?ahead|falling behind)\b|\b(?:growth|grew|grows?|outperform\w*|keeping pace|pulling\s+(?:further\s+)?ahead|falling behind)\b.{0,60}\b(?:peers?|cohort|group|benchmark|median)\b/gi;
    for (const assertion of clause.matchAll(trend)) if (!historicalAssertionWithdrawn(clause, assertion)) {
      problems.add("Separate dated peer medians are cross-sections, not comparable-cohort growth. Report the current median and coverage; hold peer-growth conclusions until membership and merger treatment are established.");
    }
    const adjusted = /\b(?:merger[ -]adjusted|unchanged economic perimeter|constant[ -]cohort|apples[ -]to[ -]apples)\b/gi;
    for (const assertion of clause.matchAll(adjusted)) if (!historicalAssertionWithdrawn(clause, assertion)) {
      problems.add("Matching institution or charter IDs does not establish an unchanged economic perimeter or a merger-adjusted trend. Retain the lifecycle uncertainty and report dated cross-sections.");
    }
    const stability = /\b(?:same|identical|unchanged|constant|stable|balanced|matched)\s+(?:(?:reporting|charter|institution|peer)\s+){0,3}(?:IDs|institutions|reporters|population|membership|cohort)\b|\b(?:reporting population|cohort membership|reporters)\b.{0,35}\b(?:same|identical|unchanged|constant|stable|balanced|matched)\b/gi;
    for (const assertion of clause.matchAll(stability)) if (!historicalAssertionWithdrawn(clause, assertion)) {
      if (/\bcharter\s+IDs\b/i.test(assertion[0])) {
        problems.add("Matching database reporter IDs does not establish historical regulator charter-ID stability. The identity references are current registry links, not dated identity history.");
      } else if (history?.matching_reporter_ids !== true) {
        problems.add("Population stability needs complete matching dated reporter-ID lists for the same measure, source, unit and basis. Counts, current membership and truncated lists do not establish it.");
      }
    }
    const causes = [
      { pattern: /\b(?:gap|difference|income|revenue|comparison|lead|rank(?:ing)?|position)\b.{0,80}\b(?:reflects?|explained by|due to|driven by|results? from|comes? from|stems? from|because of)\b.{0,50}\b(?:size|scale|assets?)\b/gi,
        problem: "A dollar-income peer gap does not establish that size, rather than pricing, caused it. State the unadjusted comparison and the missing causal evidence." },
      { pattern: /\b(?:market|pricing|prices?|zero[ -]fee|overdraft fees?)\b.{0,80}\b(?:driv\w*|drove|caus\w*|keeps?|kept|explains?|remov\w*|responsible)\b|\b(?:growth|income|revenue)\b.{0,70}\b(?:driven|caused|explained)\s+by\b.{0,50}\b(?:market|pricing|prices?|fees?)\b/gi,
        problem: "Observed totals and peer correlations do not establish a pricing or market cause, or rank dividend-cost changes against unmeasured fee changes. State the observation and the missing causal evidence." },
    ];
    if (evidence.financialPeerComparison || history?.observed === true) for (const { pattern, problem } of causes) {
      for (const assertion of clause.matchAll(pattern)) if (!historicalAssertionWithdrawn(clause, assertion)) {
        problems.add(problem);
      }
    }
    if ((history?.catalog_observed !== true && history?.national_financial_observed !== true) || !topic.test(clause)) continue;
    const figures = extractFigures(clause); const sizes = tierBoundsAsSize(clause, figures);
    const periods = claimedPeriods(clause);
    for (const figure of figures.filter((value) => value.kind === "usd" && !value.denominatorUnit && !sizes.has(value))) {
      const ytd = /\b(?:year[ -]to[ -]date|YTD|six[ -]month total)\b/i.test(clause);
      const quarter = !ytd && /\b(?:standalone|quarter[ -]only|Q[1-4]|(?:first|second|third|fourth) quarter)\b/i.test(clause);
      const explicitQuarter = /\b(?:standalone|quarter[ -]only)\b/i.test(clause);
      const ncuaClaim = /\bNCUA\b|\b(?:broad|credit[ -]union)\s+fee income\b/i.test(clause);
      const bankClaim = /\b(?:FDIC|FFIEC)\b|\b(?:bank|deposit[ -]account|deposit[ -]only)\s+(?:fee income|service[ -]charges?)\b/i.test(clause);
      const feeIncome = /\b(?:fee[ -]income|service[ -]charge(?:s| income)?)\b/i.test(clause);
      const metricMatches = (measure: unknown) => {
        if (/\b(?:deposit[ -]account|deposit[ -]only)\s+service[ -]charges?\b|\bservice[ -]charges?\s+on\s+deposits\b/i.test(clause)) return measure === "call:service_charges_deposits_ytd";
        if (/\bATM\b/i.test(clause) && feeIncome) return ["call:consumer_atm_fees_ytd", "call:atm_income_ytd"].includes(String(measure));
        if (/\bmaintenance\b/i.test(clause) && feeIncome) return measure === "call:consumer_maintenance_charges_ytd";
        if (/\bwire\b/i.test(clause) && feeIncome) return measure === "call:wire_transfer_income_ytd";
        if (feeIncome) return measure === "call:acct_131" || measure === "call:service_charges_deposits_ytd";
        if (/\bdividend\s+expense\b/i.test(clause)) return measure === "call:acct_380";
        if (/\btotal assets\b/i.test(clause)) return measure === "call:total_assets";
        if (/\btotal deposits\b/i.test(clause)) return measure === "call:total_deposits";
        if (/\bshare[ -]draft balances?\b/i.test(clause)) return measure === "call:acct_902";
        return true;
      };
      const candidates = observations.filter((row) => row.unit === "USD"
        && (!ncuaClaim || row.source === "ncua") && (!bankClaim || row.source === "ffiec")
        && metricMatches(row.measure)
        && (!ytd || row.period_basis === "ytd") && (!quarter || row.period_basis === "standalone_quarter" || (!explicitQuarter && row.period_basis === "point_in_time")
          || (row.period_basis === "ytd" && String(row.period).endsWith("03-31")))
        && periods.length <= 1 && (periods.length === 0 || String(row.period).startsWith(periods[0])));
      if (!candidates.some((row) => (Array.isArray(row.values) ? (/\bmedian\b/i.test(clause) ? [row.median] : row.values) : [])
        .some((value) => finite(value) !== null && Math.abs(Number(value) - figure.value) <= figure.tolerance))) {
        problems.add("State each call-report peer figure with its observed measure, regulator, reporting date, unit and period basis. A year-to-date median is not a later standalone quarter, and NCUA broad income is not FDIC deposit service charges.");
      }
    }
  }
  return [...problems];
}

/** Specific known interpretation failures, with actionable feedback for regeneration. */
export function checkAnswerInterpretations(text: string, data: unknown, question?: string): string[] {
  // The written-answer boundary reconstructs this verdict from its observed reads.
  // It applies to both regulators, including when contradictions leave no usable facts.
  if (record(data)?.filed_peer_income_conflict === true) {
    return ["Conflicting filed financial peer reads need to be refreshed before presenting this answer. Keep the selected institution, source, quarter and peer filters consistent."];
  }
  const evidence = evidenceFrom(data);
  const historyProblems = historicalPeerProblems(text, data, evidence);
  if (!evidence.ncua && !evidence.financialPeerComparison) return historyProblems;
  const problems = new Set<string>(historyProblems);
  if (evidence.ncua && evidence.incomplete) problems.add("The NCUA interpretation check could not inspect all structured evidence within its limits. Narrow the evidence before presenting this answer.");
  if (evidence.ncua) for (const problem of quarterQuestionProblems(text, question, evidence)) problems.add(problem);
  if (evidence.financialPeerComparison) for (const sentence of text.split(/\r?\n+|(?<=[.!?])\s+/)) {
    const completeness = /\ball\s+(?:\d+\s+)?(?:(?:(?:eligible|financial)\s+){0,2}(?:credit unions?|banks?|institutions?|peers?|filers?)\s+)?(?:reported|filed)\b|\b(?:complete|full)\s+(?:filing\s+)?coverage\b/i;
    if (!completeness.test(sentence)) continue;
    const qualities = sentence.matchAll(/\b(?:benchmark|comparison|cohort|sample)\s+(?:is|was|looks?|seems?|remains?)\s+(?:strong|reliable|robust|representative)\b|\b(?:strong|reliable|robust|representative)\s+(?:financial\s+)?(?:benchmark|comparison|cohort|sample)\b/gi);
    for (const quality of qualities) {
      const prefix = sentence.slice(0, quality.index);
      const local = prefix.split(/[;,]|\b(?:and|but|yet|however|while|nevertheless)\b/i).at(-1) ?? "";
      const feePrice = /\b(?:fee[ -]price|published fee prices?|fee[ -]schedule prices?)\b/i;
      const financial = /\b(?:financial|filers?|filings?|call reports?|fee income|service[ -]charge income|revenue)\b/i;
      const domain = feePrice.test(local) || financial.test(local) ? local : prefix;
      const priceMaturity = feePrice.test(domain) && !financial.test(`${domain} ${quality[0]}`);
      const negated = /\b(?:is|was|are|were)\s+not\s+(?:an?\s+)?$|\b(?:does not|doesn't|do not|don't|cannot|can't|did not|didn't)\s+(?:make|establish|prove|show|imply|ensure|guarantee)\s+(?:(?:this|that|it)\s+)?(?:an?\s+)?$/i.test(prefix);
      if (!priceMaturity && !negated && !explicitlyWithdrawn(sentence, quality)) {
        problems.add("Complete reporting for the stated financial cohort establishes coverage, not benchmark strength, reliability or representativeness. State the counts and limitations without inferring quality from completeness.");
      }
    }
  }
  if (!evidence.ncua) return [...problems];
  const broadIncome = evidence.selectedId ? evidence.broadIncomeIds.has(evidence.selectedId) : evidence.broadIncomeIds.size > 0;
  const clauses = text.split(/\r?\n+|(?<=[.!?])\s+|;\s*|,\s*(?:but|yet|however|therefore|thus|so)\s+|\s+(?:but|however|therefore|thus)\s+|\s+and\s+(?=(?:its?|their|the|\w+'s)\s+)/i);
  for (const raw of clauses) {
    const clause = raw.replace(/^\s*[-*#]+\s*/, "").trim();
    if (!clause || (/^(?:how|what|which|could|can|would|does|do)\b/i.test(clause) && clause.endsWith("?"))) continue;
    if (broadIncome) {
      const exclusions = clause.matchAll(/\bnot\s+(?:an?\s+)?overdraft\s+(?:income|revenue)\b|\b(?:excludes?|excluding|does not include|doesn't include|contains? no)\s+(?:any\s+)?overdraft(?:\s+(?:fees?|income|revenue))?\b|\boverdraft(?:\s+(?:fees?|income|revenue))?\s+(?:(?:is|are|was|were)\s+)?excluded\s+from\s+(?:broad\s+)?(?:NCUA\s+)?fee income\b/gi);
      for (const exclusion of exclusions) {
        const prefix = clause.slice(0, exclusion.index);
        const local = prefix.split(/[;,]|\b(?:and|but|yet|however|while|nevertheless)\b/i).at(-1) ?? "";
        const priceSubject = /\b(?:schedule|published price|fee price)\b/i.test(local) && !/\b(?:broad|NCUA|total|fee income)\b/i.test(local);
        const qualified = /^\s*(?:only|alone)\b/i.test(clause.slice(exclusion.index + exclusion[0].length));
        const negated = /\b(?:does not|doesn't|do not|don't|cannot|can't|did not|didn't)\s*$/i.test(prefix);
        if (!priceSubject && !qualified && !negated && !explicitlyWithdrawn(clause, exclusion)) {
          problems.add("Broad NCUA fee income includes overdraft fees; it does not isolate them. Say not overdraft-only income or that a separate overdraft amount is unavailable, rather than excluding overdraft from the broad total.");
        }
      }
    }
    const memberTopic = /\b(?:members?(?:hip)?|customers?)\b/i;
    const memberChange = /\b(?:members?(?:hip)?|customers?)(?:\s+(?:base|count|numbers?|growth|is|are|has|have|was|were|had)){0,4}\s+(?:grow\w*|grew|increas\w*|expanded|rose|rising|fell|falling|declin\w*|decreas\w*|shrank|shrinking)\b|\b(?:member|membership|customer)\s+growth\b|\b(?:more|fewer|new|additional)\s+(?:members?|customers?)\b/i;
    if (memberChange.test(clause) && !refuses(clause, memberTopic) && !memberGrowthSupported(clause, evidence)) {
      problems.add("Checking-account counts do not establish member or customer growth. Use account growth, or supply a same-institution, same-period member-count series.");
    }
    const paidDividends = /\b(?:paid|pays?|paying|disbursed|cash payments?)\b.{0,80}\b(?:share\s+)?dividends?\b|\b(?:share\s+)?dividends?\b.{0,60}\b(?:paid|disbursed|cash payments?)\b/i;
    const expenseCaveat = /\b(?:dividends?(?:[ -]+on[ -]+shares)?|share)\s+(?:(?:were|was|are|is)\s+(?:an?\s+)?)?expense\b.{0,65}?\b(?:not|rather than)\s+(?:a\s+measure\s+of\s+)?(?:cash paid|cash payments?|paid|disbursed)\b/gi;
    // Remove the scoped negative equivalence only, so a later positive "paid"
    // assertion in the same clause must still pass the check itself.
    const dividendClaim = clause.replace(expenseCaveat, "");
    if (evidence.dividendExpense && paidDividends.test(dividendClaim) && !refuses(dividendClaim, /\b(?:dividends?|cash paid|cash payments?)\b/i)) {
      problems.add("NCUA dividends on shares establish YTD dividend expense, not cash paid. Keep the expense label and state that cash payments are not established.");
    }
    const zeroOverdraftRevenue = /\boverdrafts?\b.{0,70}\b(?:income|revenue)\b.{0,25}(?:\b(?:zero|none|nothing|no)\b|\$0\b)|(?:\b(?:no|zero)\b|\$0\b)\s+(?:per[ -]item\s+)?overdraft\s+(?:income|revenue)\b|\b(?:earns?|earned|generates?|generated|receives?|received)\s+(?:no|zero|\$0)\b.{0,35}\boverdrafts?\b/i;
    // The zero can precede its revenue noun, or follow it; the overdraft subject
    // can also follow "from". Neither ordering turns an absent breakdown into zero.
    const zeroBeforeRevenue = /\boverdrafts?\b.{0,70}(?:\b(?:no|zero)\b|\$0\b)\s+(?:(?:realized|per[ -]item)\s+)?(?:income|revenue)\b|(?:\b(?:no|zero)\b|\$0\b)\s+(?:(?:realized|per[ -]item)\s+)?(?:income|revenue)\b.{0,50}\b(?:from|on)\s+overdrafts?\b/i;
    const otherFeesOnly = /\b(?:fee\s+(?:income|revenue)|income|revenue)\s+(?:comes?|came|is|was)\s+(?:entirely\s+|only\s+|all\s+)?from\s+other\s+(?:fees?|charges?)\b/i;
    if ((zeroOverdraftRevenue.test(clause) || zeroBeforeRevenue.test(clause) || otherFeesOnly.test(clause)) && !refuses(clause, /\b(?:overdrafts?|revenue|income)\b/i)
      && !reportedLineSupports(clause, evidence, ["overdraft_revenue", "overdraft_income", "overdraft_fee_income"], "USD", true)) {
      problems.add("A current overdraft price or broad fee-income total does not establish realized overdraft revenue, including zero. Leave the overdraft component unavailable without its own dated reported line.");
    }
    const payers = /\b(?:no|zero|\d[\d,]*)\s+(?:members?|customers?|payers?)\b.{0,50}\b(?:paid|pay|charged)\b.{0,35}\b(?:overdraft|fees?)\b|\b(?:overdraft\s+)?(?:payers?|paying members?)\s*(?:count|number)?\s*(?:was|were|is|are|:)\s*(?:zero|none|\d[\d,]*)\b|\b(?:nobody|no[ -]?one|not a single (?:member|customer|payer)|none of (?:the |its |their )?(?:members|customers|payers))\b.{0,40}\b(?:paid|pays?|charged)\b.{0,35}\boverdrafts?\b/i;
    if (payers.test(clause) && !refuses(clause, /\b(?:members?|customers?|payers?|paid)\b/i)
      && !reportedLineSupports(clause, evidence, ["overdraft_payer_count"], "count", false)) {
      problems.add("The supplied NCUA measures do not report overdraft payer counts. Do not infer members paying fees from account counts, schedule prices or aggregate income.");
    }
    const districtTooSmall = /\bdistrict\s+\d{1,2}\b.{0,100}\b(?:too (?:small|few)|insufficient|not enough|fewer than (?:5|five|10|ten)|below (?:5|five|10|ten))\b/i;
    const districtClaim = clause.match(districtTooSmall);
    if (districtClaim && !explicitlyWithdrawn(clause, districtClaim) && !districtSizeSupported(clause, evidence)) {
      problems.add("A nationwide peer read does not establish that an unqueried district group is too small. Query the same group with that district filter, or say its coverage has not been checked.");
    }
    const absentOverdraftField = /\b(?:NCUA|filings?|call reports?|5300)\b.{0,70}\b(?:has|have|contains?|includes?|reports?)\s+no\s+(?:reported\s+)?overdraft(?:[ -]only)?(?:[ -](?:income|revenue))?\s+(?:line|field)\b|\b(?:NCUA|filings?|call reports?|5300)\b.{0,70}\b(?:does not|doesn't|do not|don't)\s+(?:contain|include|have|report)\s+(?:an?\s+)?overdraft(?:[ -]only)?(?:[ -](?:income|revenue))?\s+(?:line|field)\b|\b(?:NCUA|filings?|call reports?|5300)\b.{0,220}\b(?:with no|without(?: an?)?)\s+overdraft(?:[ -]only)?(?:[ -](?:income|revenue))?\s+(?:line|field)\b/i;
    const fieldClaim = clause.match(absentOverdraftField);
    if (fieldClaim && !explicitlyWithdrawn(clause, fieldClaim)) {
      problems.add("A missing or unusable overdraft figure in available evidence does not prove the NCUA filing has no overdraft line. Describe the missing usable figure without asserting absence from the publisher's schema.");
    }
    const peerTrend = /(?:\bpeer(?:s|'s|s')?\b|\b(?:state|national|metro)\s+(?:peer\s+)?(?:median|group)\b).{0,65}\b(?:grew|grow\w*|rose|increas\w*|decreas\w*|fell|declin\w*|pace|pulling\s+(?:further\s+)?ahead|falling behind)\b|\b(?:growth|grows?|grew|pulling\s+(?:further\s+)?ahead|falling behind)\b.{0,50}\b(?:peers?|group|median)\b|\b(?:keeping|keeps?|kept)\s+pace\b/i;
    // No current tool supplies a verified comparable-cohort contract. A single
    // current cross-section is no more evidence of growth than two changing ones.
    if (peerTrend.test(clause) && !refuses(clause, /\b(?:peers?|group|median|trend|growth)\b/i)) {
      problems.add("Separate dated peer medians are cross-sections, not comparable-cohort growth. Report the current median and coverage; hold peer-growth conclusions until membership and merger treatment are established.");
    }
    const sizeCause = /\b(?:gap|difference|income|revenue|comparison|lead|rank(?:ing)?|position)\b.{0,80}\b(?:reflects?|explained by|due to|driven by|results? from|comes? from|stems? from|because of)\b.{0,50}\b(?:size|scale|assets?)\b/i;
    const sizeClaim = clause.match(sizeCause);
    if (sizeClaim && !explicitlyWithdrawn(clause, sizeClaim) && !refuses(clause, /\b(?:cause|size|scale|gap|difference)\b/i)) {
      problems.add("A dollar-income peer gap does not establish that size, rather than pricing, caused it. State the unadjusted comparison and the missing causal evidence.");
    }
    const soleCohort = /\b(?:only|sole)\s+(?:(?:true|valid|real|proper|genuine|appropriate|comparable)\s+)+(?:size\s+)?(?:peer\s+)?(?:group|cohort|comparison)\b/i;
    const soleClaim = clause.match(soleCohort);
    const solePrefix = soleClaim ? clause.slice(0, soleClaim.index) : "";
    if (soleClaim && !explicitlyWithdrawn(clause, soleClaim) && !/\b(?:is|are|was|were)\s+not\s+(?:the\s+)?$/i.test(solePrefix)) {
      problems.add("A selected size band is one stated cohort definition, not the only true or valid peer group. Name its criteria and limits without dismissing other legitimate cohorts.");
    }
    const peerMultiple = /\b(?:peers?|median|benchmark|comparison|gap)\b/i.test(clause)
      ? [...clause.matchAll(/\b(\d+)(?:\.(\d+))?\s*(?:times\b|[x×])/gi)] : [];
    for (const multiple of peerMultiple) {
      const value = Number(`${multiple[1]}${multiple[2] ? `.${multiple[2]}` : ""}`);
      const tolerance = 0.5 * 10 ** -(multiple[2]?.length ?? 0);
      const periods = claimedPeriods(clause);
      if (!evidence.peerMultipliers.some((ratio) => Math.abs(ratio.value - value) <= tolerance && (periods.length === 0 || periods.some((period) => ratio.period.startsWith(period))))) {
        problems.add("The peer-income multiple is not in the server-validated calculation ledger. Report the sourced income and median without an unvalidated quotient.");
      }
    }
    const pricingCause = /\b(?:market|pricing|prices?|zero[ -]fee|overdraft fees?)\b.{0,80}\b(?:driv\w*|drove|caus\w*|keeps?|kept|explains?|remov\w*|responsible)\b|\b(?:growth|income|revenue)\b.{0,70}\b(?:driven|caused|explained)\s+by\b.{0,50}\b(?:market|pricing|prices?|fees?)\b/i;
    const fundingCounterfactual = /\b(?:dividend|funding)\s+costs?\b.{0,90}\b(?:more|less|greater|larger|smaller)\b.{0,50}\b(?:fee schedule|fee pricing|pricing|fee change)\b/i;
    const onlyRates = /\b(?:earns?|earned|generates?|generated)\b.{0,45}\brevenue\b.{0,35}\b(?:through|from)\s+rates?\s*,?\s*(?:not|rather than)\s+fees?\b/i;
    const causalClaim = clause.match(pricingCause) ?? clause.match(fundingCounterfactual) ?? clause.match(onlyRates);
    if (causalClaim && !explicitlyWithdrawn(clause, causalClaim) && !refuses(clause, /\b(?:cause|pricing|market|fees?|revenue|income)\b/i)) {
      problems.add("Observed totals and peer correlations do not establish a pricing or market cause, or rank dividend-cost changes against unmeasured fee changes. State the observation and the missing causal evidence.");
    }
  }
  return [...problems];
}

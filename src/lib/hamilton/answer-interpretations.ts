/**
 * Bounded semantic checks for the NCUA measures Hamilton can currently discover.
 * These catch known substitutions in the five-question NCUA evaluation, not arbitrary
 * natural-language truth. Numerical/source checks remain separate and the source hold
 * remains the caller's responsibility. Discovery alone never proves a reported value.
 */

export const HAMILTON_INTERPRETATION_INSTRUCTION = `
SOURCE MEANING:
- An NCUA share-draft count is accounts, not members or customers. Describe account growth as account growth; member growth needs its own same-institution, same-period member-count evidence.
- NCUA dividends on shares are reported year-to-date expense, not evidence of cash paid. Keep the expense label even when the question says "paid".
- A current fee schedule is a price, not realized revenue or a historical record of prices, waivers, refunds or charged items. A $0 overdraft price cannot establish zero overdraft income or zero paying members in a prior period. Broad fee income cannot identify either figure; say unavailable unless a dedicated reported line answers it.
- A cross-sectional peer median describes the filers for that date. Do not call changes between separately selected quarterly peer populations growth, outperformance, keeping pace or falling behind. A common comparable cohort, including merger treatment, is needed first. You may report the current median, its date and coverage.
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
interface Evidence {
  ncua: boolean;
  incomplete: boolean;
  accountMeasure: boolean;
  observations: Observation[];
  accountDates: Map<string, Set<string>>;
  dividendExpense: boolean;
  peerPeriods: Set<string>;
  selectedIds: Set<string>;
  selectedId: string | null;
}

const record = (v: unknown): RecordValue | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as RecordValue : null;
const finite = (v: unknown): number | null => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) && Number.isFinite(Number(v)) ? Number(v) : null;
const textValue = (v: unknown): string | null => typeof v === "string" && v.trim() ? v : null;
const ncuaSource = (r: RecordValue): boolean => /\bncua\b/i.test(String(r.source ?? "")) || /\bNCUA\b/i.test(String(r.publisher ?? ""));

function evidenceFrom(data: unknown): Evidence {
  const result: Evidence = { ncua: false, incomplete: false, accountMeasure: false, observations: [], accountDates: new Map(), dividendExpense: false, peerPeriods: new Set(), selectedIds: new Set(), selectedId: null };
  let visited = 0;
  const seen = new WeakSet<object>();
  function visit(value: unknown, depth: number, scopeId: string | null = null): void {
    if (++visited > 5000 || depth > 16) { result.incomplete = true; return; }
    if (typeof value === "string") {
      if (/^[\s]*[\[{]/.test(value)) {
        if (value.length > 1_000_000) { result.incomplete = true; return; }
        try { visit(JSON.parse(value), depth + 1, scopeId); } catch { /* Prose is not evidence. */ }
      }
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { for (const child of value) visit(child, depth + 1, scopeId); return; }
    const r = value as RecordValue;
    if (finite(r.selected_institution_id) !== null && Number(r.selected_institution_id) > 0) result.selectedId = String(r.selected_institution_id);
    const input = record(r.input);
    const scope = record(input?.scope);
    const id = scope?.kind === "institution" && scope.id != null ? String(scope.id) : scopeId;
    if (ncuaSource(r)) result.ncua = true;
    const metadata = record(r.measure_metadata);
    // Captions identify a measure's limitations, even when its value is missing.
    // They never supply an observation or authorize a reported fact.
    if (ncuaSource(r) || (metadata && ncuaSource(metadata))) {
      if (r.measure === "call:acct_452" || r.metric === "acct_452") result.accountMeasure = true;
      if (r.measure === "call:acct_380" || r.metric === "acct_380") result.dividendExpense = true;
    }
    // Only a successful query with rows can establish a measure. listData captions
    // and peer member_count (number of institutions) cannot establish member counts.
    if (r.ok === true && typeof r.measure === "string" && Array.isArray(r.rows) && metadata && ncuaSource(metadata)) {
      const metric = r.measure.replace(/^call:/, "");
      for (const value of r.rows) {
        const row = record(value);
        const period = textValue(row?.period);
        if (!row || !period) continue;
        if (r.scope === "peer_set" && finite(row.median) !== null) result.peerPeriods.add(period);
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
    for (const child of Object.values(r)) visit(child, depth + 1, id);
  }
  visit(data, 0);
  return result;
}

/** A dedicated line may answer the question; a price or another subject's line cannot. */
function reportedLineSupports(clause: string, evidence: Evidence, metrics: readonly string[], unit: string, zero: boolean): boolean {
  const explicitDate = clause.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  const monthDate = clause.match(/\b(March|June|September|December)\s+(?:(\d{1,2}),?\s+)?(20\d{2})\b/i);
  const months: Record<string, string> = { march: "03", june: "06", september: "09", december: "12" };
  const claimedPeriod = explicitDate ? explicitDate[0]
    : monthDate ? `${monthDate[3]}-${months[monthDate[1].toLowerCase()]}${monthDate[2] ? `-${monthDate[2].padStart(2, "0")}` : ""}` : null;
  if (!claimedPeriod) return false;
  const subjectIds = evidence.selectedId ? new Set([evidence.selectedId])
    : evidence.selectedIds.size ? evidence.selectedIds : new Set(evidence.accountDates.keys());
  if (subjectIds.size !== 1) return false;
  const payerMatch = clause.match(/\b(no|zero|\d[\d,]*)\s+(?:members?|customers?|payers?)\b/i)
    ?? clause.match(/\b(?:payers?|paying members?)\s*(?:count|number)?\s*(?:was|were|is|are|:)\s*(zero|none|\d[\d,]*)\b/i);
  const payerValue = payerMatch ? /^(?:no|zero|none)$/i.test(payerMatch[1]) ? 0 : Number(payerMatch[1].replace(/,/g, "")) : null;
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
    if (sortedDates.length < 2) continue;
    const first = sortedDates[0], last = sortedDates.at(-1)!;
    const members = evidence.observations.filter((o) => o.metric === "member_count" && o.institutionId === id && o.unit === "count");
    const earlier = members.find((o) => o.period === first);
    const latest = members.find((o) => o.period === last);
    if (!earlier || !latest) continue;
    const years = clause.match(/\b20\d{2}\b/g) ?? [];
    if (years.some((year) => ![first.slice(0, 4), last.slice(0, 4)].includes(year))) continue;
    const otherNames = evidence.observations.filter((o) => o.institutionId !== id && o.institutionName).map((o) => o.institutionName!);
    if (otherNames.some((name) => clause.toLowerCase().includes(name.toLowerCase()))) continue;
    if (/\b(?:fell|falling|declin\w*|decreas\w*|shrank|shrinking)\b/i.test(clause)) return latest.value < earlier.value;
    return latest.value > earlier.value;
  }
  return false;
}

/** Negations apply to the claim's clause, never to an entire answer. */
function refuses(clause: string, topic: RegExp): boolean {
  const refusal = /\b(?:cannot|can't|does not|do not|did not|doesn't|don't|didn't|is not|isn't|are not|aren't|not enough(?: (?:data|evidence|information))? to|insufficient(?: (?:data|evidence|information))? to|no basis to)\s+(?:\w+[ -]){0,5}(?:infer|establish|show|prove|determine|identify|conclude|mean|imply|tell|say|reveal|attribute|evidence|measure|known|available|reported|supported)|\b(?:unavailable|unknown|unreported|not (?:established|reported|available|shown|known|measured|supported))\b/i;
  const absentLine = /\bno\s+(?:overdraft\s+)?(?:income|revenue|payer counts?)\s+(?:is|was|has been)\s+reported\b/i;
  return (refusal.test(clause) || absentLine.test(clause)) && topic.test(clause);
}

/** Specific known interpretation failures, with actionable feedback for regeneration. */
export function checkAnswerInterpretations(text: string, data: unknown): string[] {
  const evidence = evidenceFrom(data);
  if (!evidence.ncua) return [];
  const problems = new Set<string>();
  if (evidence.incomplete) problems.add("The NCUA interpretation check could not inspect all structured evidence within its limits. Narrow the evidence before presenting this answer.");
  const clauses = text.split(/\r?\n+|(?<=[.!?])\s+|;\s*|,\s*(?:but|yet|however|therefore|thus|so)\s+|\s+(?:but|however|therefore|thus)\s+|\s+and\s+(?=(?:its?|their|the|\w+'s)\s+)/i);
  for (const raw of clauses) {
    const clause = raw.replace(/^\s*[-*#]+\s*/, "").trim();
    if (!clause || (/^(?:how|what|which|could|can|would|does|do)\b/i.test(clause) && clause.endsWith("?"))) continue;
    const memberTopic = /\b(?:members?(?:hip)?|customers?)\b/i;
    const memberChange = /\b(?:members?(?:hip)?|customers?)(?:\s+(?:base|count|numbers?|growth|is|are|has|have|was|were|had)){0,4}\s+(?:grow\w*|grew|increas\w*|expanded|rose|rising|fell|falling|declin\w*|decreas\w*|shrank|shrinking)\b|\b(?:member|membership|customer)\s+growth\b|\b(?:more|fewer|new|additional)\s+(?:members?|customers?)\b/i;
    if (evidence.accountMeasure && memberChange.test(clause) && !refuses(clause, memberTopic) && !memberGrowthSupported(clause, evidence)) {
      problems.add("Checking-account counts do not establish member or customer growth. Use account growth, or supply a same-institution, same-period member-count series.");
    }
    const paidDividends = /\b(?:paid|pays?|paying|disbursed|cash payments?)\b.{0,80}\b(?:share\s+)?dividends?\b|\b(?:share\s+)?dividends?\b.{0,60}\b(?:paid|disbursed|cash payments?)\b/i;
    const expenseCaveat = /\b(?:dividend|share)\s+expense\b.{0,45}\b(?:not|rather than)\b.{0,20}\b(?:cash paid|cash payments?|paid|disbursed)\b/i;
    if (evidence.dividendExpense && paidDividends.test(clause) && !expenseCaveat.test(clause) && !refuses(clause, /\b(?:dividends?|cash paid|cash payments?)\b/i)) {
      problems.add("NCUA dividends on shares establish YTD dividend expense, not cash paid. Keep the expense label and state that cash payments are not established.");
    }
    const zeroOverdraftRevenue = /\boverdrafts?\b.{0,70}\b(?:income|revenue)\b.{0,25}(?:\b(?:zero|none|nothing|no)\b|\$0\b)|(?:\b(?:no|zero)\b|\$0\b)\s+(?:per[ -]item\s+)?overdraft\s+(?:income|revenue)\b|\b(?:earns?|earned|generates?|generated|receives?|received)\s+(?:no|zero|\$0)\b.{0,35}\boverdraft\b/i;
    const otherFeesOnly = /\b(?:fee\s+(?:income|revenue)|income|revenue)\s+(?:comes?|came|is|was)\s+(?:entirely\s+|only\s+|all\s+)?from\s+other\s+(?:fees?|charges?)\b/i;
    if ((zeroOverdraftRevenue.test(clause) || otherFeesOnly.test(clause)) && !refuses(clause, /\b(?:overdraft|revenue|income)\b/i)
      && !reportedLineSupports(clause, evidence, ["overdraft_revenue", "overdraft_income", "overdraft_fee_income"], "USD", true)) {
      problems.add("A current overdraft price or broad fee-income total does not establish realized overdraft revenue, including zero. Leave the overdraft component unavailable without its own dated reported line.");
    }
    const payers = /\b(?:no|zero|\d[\d,]*)\s+(?:members?|customers?|payers?)\b.{0,50}\b(?:paid|pay|charged)\b.{0,35}\b(?:overdraft|fees?)\b|\b(?:overdraft\s+)?(?:payers?|paying members?)\s*(?:count|number)?\s*(?:was|were|is|are|:)\s*(?:zero|none|\d[\d,]*)\b/i;
    if (payers.test(clause) && !refuses(clause, /\b(?:members?|customers?|payers?|paid)\b/i)
      && !reportedLineSupports(clause, evidence, ["overdraft_payer_count"], "count", false)) {
      problems.add("The supplied NCUA measures do not report overdraft payer counts. Do not infer members paying fees from account counts, schedule prices or aggregate income.");
    }
    const peerTrend = /\bpeer(?:s|'s|s')?\b.{0,65}\b(?:grew|grow\w*|rose|increas\w*|decreas\w*|fell|declin\w*|pace|pulling\s+(?:further\s+)?ahead|falling behind)\b|\b(?:growth|grows?|grew|pulling\s+(?:further\s+)?ahead|falling behind)\b.{0,50}\b(?:peers?|group|median)\b|\b(?:keeping|keeps?|kept)\s+pace\b/i;
    if (evidence.peerPeriods.size > 1 && peerTrend.test(clause) && !refuses(clause, /\b(?:peers?|group|median|trend|growth)\b/i)) {
      problems.add("Separate dated peer medians are cross-sections, not comparable-cohort growth. Report the current median and coverage; hold peer-growth conclusions until membership and merger treatment are established.");
    }
    const pricingCause = /\b(?:market|pricing|prices?|zero[ -]fee|overdraft fees?)\b.{0,80}\b(?:driv\w*|drove|caus\w*|keeps?|kept|explains?|remov\w*|responsible)\b|\b(?:growth|income|revenue)\b.{0,70}\b(?:driven|caused|explained)\s+by\b.{0,50}\b(?:market|pricing|prices?|fees?)\b/i;
    const fundingCounterfactual = /\b(?:dividend|funding)\s+costs?\b.{0,90}\b(?:more|less|greater|larger|smaller)\b.{0,50}\b(?:fee schedule|fee pricing|pricing|fee change)\b/i;
    const onlyRates = /\b(?:earns?|earned|generates?|generated)\b.{0,45}\brevenue\b.{0,35}\b(?:through|from)\s+rates?\s*,?\s*(?:not|rather than)\s+fees?\b/i;
    if ((pricingCause.test(clause) || fundingCounterfactual.test(clause) || onlyRates.test(clause)) && !refuses(clause, /\b(?:cause|pricing|market|fees?|revenue|income)\b/i)) {
      problems.add("Observed totals and peer correlations do not establish a pricing or market cause, or rank dividend-cost changes against unmeasured fee changes. State the observation and the missing causal evidence.");
    }
  }
  return [...problems];
}

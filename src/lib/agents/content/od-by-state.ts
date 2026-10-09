import { sql } from "@/lib/data-store/connection";
import { computePercentile } from "@/lib/data-store/fees";
import { STATS_ROW_FILTER, STRONG_INSTITUTION_COUNT, valuePerInstitution } from "@/lib/data-store/fee-stats";
import { contentSchemaReady, insertContentDraft } from "@/lib/data-store/content-drafts";
import { unbackedNumbers } from "@/lib/agents/marketing/facts";
import { PRODUCT_NAME, RESEARCH_IMPRINT, SITE_URL } from "@/lib/constants";
import { STATE_NAMES, US_STATES_ONLY } from "@/lib/us-states";

/**
 * Ernest's weekly fee article (build plan 2.9 and 2.10, free, no model). Each week takes the
 * next fee in FEE_TOPICS that has no article this month, starting with overdraft, and writes
 * it around a finding rather than a list (James, Oct 8 2026: "you are restating the data and
 * not creating something worth following"):
 *
 * - how the fee moves with institution size, banks and credit unions apart (the headline
 *   when either moves),
 * - banks against credit unions of the same size,
 * - how wide the fee runs inside a state against how little state medians differ,
 * - for overdraft, the cheaper transfer most schedules also list,
 * - what it means for a pricing team, then every state with enough data.
 *
 * The article is a research article draft (`research_articles`, status draft) filed in the
 * growth queue. Nothing publishes: James publishes it from /admin/hamilton/research/articles.
 * A draft nobody has edited is rewritten with current numbers on the next run.
 *
 * Statistics follow `fee-stats.ts`: sourced consumer rows, one value per institution,
 * overdraft at its highest tier, $0 counts. A group is shown only with
 * STRONG_INSTITUTION_COUNT institutions behind it. No institution is named, and the wording
 * stays neutral ("lower" / "higher"). Every number in the text is checked against the
 * summary before anything is written.
 */

type SqlTag = typeof sql;

/** The workflow name predates the other topics; kept so the cadence counts every draft. */
export const OD_BY_STATE_WORKFLOW = "ernest-od-by-state";
export const OD_CATEGORY = "overdraft";
/** A run within this many days of the last draft skips: one article a week. */
export const CADENCE_DAYS = 6;
/** A median that moves at least this many dollars from the smallest to the largest size group is a trend. */
export const TREND_DOLLARS = 2;
export const AUTHOR_TAG = "growth:ernest";

export interface FeeTopic {
  category: string;
  /** "overdraft fee": lower case except acronyms, used mid-sentence. */
  noun: string;
  /** "Overdraft fees": the title's start. */
  titlePlural: string;
  /** What the fee is charged for, after "charge more": "for an overdraft". */
  chargeFor: string;
  /** Words that mark a tracked bill or rule as about this fee. */
  lawKeywords: string[];
  /** How an institution with several amounts is counted. No numbers. */
  method: string;
}

/** Article topics in the order they are written each month. */
export const FEE_TOPICS: readonly FeeTopic[] = [
  {
    category: OD_CATEGORY,
    noun: "overdraft fee",
    titlePlural: "Overdraft fees",
    chargeFor: "for an overdraft",
    lawKeywords: ["overdraft"],
    method: "An institution that charges different overdraft fees by amount or by count is counted at its standard (highest) fee, and a free overdraft counts as $0.",
  },
  {
    category: "nsf",
    noun: "NSF fee",
    titlePlural: "NSF fees",
    chargeFor: "for a returned (NSF) item",
    lawKeywords: ["insufficient funds", "nsf"],
    method: "An institution that lists several NSF amounts is counted at the middle of its own amounts, and a free NSF item counts as $0.",
  },
  {
    category: "monthly_maintenance",
    noun: "monthly maintenance fee",
    titlePlural: "Monthly maintenance fees",
    chargeFor: "to keep a checking account open each month",
    lawKeywords: ["maintenance fee"],
    method: "An institution with several checking accounts is counted at the middle of its own monthly fees, and an account with no monthly fee counts as $0.",
  },
  {
    category: "atm_non_network",
    noun: "out-of-network ATM fee",
    titlePlural: "Out-of-network ATM fees",
    chargeFor: "for an out-of-network ATM withdrawal",
    lawKeywords: ["atm fee", "atm surcharge"],
    method: "An institution that lists several amounts is counted at the middle of its own amounts, and a free out-of-network withdrawal counts as $0.",
  },
];

export const OVERDRAFT_TOPIC = FEE_TOPICS[0];

/** Asset-size groups, smallest first. Labels name total assets; tiers are `asset_size_tier` values. */
export const SIZE_GROUPS = [
  { key: "small", label: "Under $300 million", tiers: ["community_small"] },
  { key: "mid", label: "$300 million to $1 billion", tiers: ["community_mid"] },
  { key: "large", label: "$1 billion to $10 billion", tiers: ["community_large"] },
  { key: "regional", label: "$10 billion to $50 billion", tiers: ["regional"] },
  { key: "national", label: "Over $50 billion", tiers: ["large_regional", "super_regional"] },
] as const;
/** Every number in a size label, so the number check accepts them. */
const SIZE_LABEL_NUMBERS = ["300", "1", "10", "50"];

export type Charter = "bank" | "credit_union";

export interface OdRow {
  institution_id: number | string;
  state_code: string;
  amount: number | string;
  charter_type?: string | null;
  asset_size_tier?: string | null;
}

/** One institution's amount for a related fee (the overdraft transfer or recurring fee). */
export interface RelatedRow {
  institution_id: number | string;
  fee_category: string;
  amount: number | string;
}

export interface SizeGroup {
  key: string;
  label: string;
  institutions: number;
  median: number;
  /** Institutions at or above the national 75th percentile. */
  highCount: number;
  /** highCount as a whole percent of institutions. */
  highShare: number;
}

export interface CharterTrend {
  charter: Charter;
  groups: SizeGroup[];
  direction: "up" | "down" | "flat";
}

export interface StateOd {
  code: string;
  name: string;
  institutions: number;
  median: number;
  low: number;
  high: number;
  /** Institutions at or below the national 25th percentile. */
  lowCount: number;
}

export interface OdSummary {
  national: { institutions: number; median: number; p25: number; p75: number } | null;
  states: StateOd[];
  /** States with some data for the fee but too few institutions to list. */
  thinStates: number;
  banks: CharterTrend;
  creditUnions: CharterTrend;
  /** Overdraft only: the transfer from a linked account, and the recurring fee for staying overdrawn. */
  transfer: { institutions: number; median: number; savings: number; free: number } | null;
  recurring: { institutions: number; median: number } | null;
  /** Overdraft only: bank overdraft revenue from the Call Report, set by the run. */
  revenue?: OdRevenue | null;
  /** Bills and rules about this fee from the regulation trackers, set by the run. */
  bills?: TrackedBill[];
}

/** One bank's quarterly overdraft revenue (Call Report RIAD H032, in thousands of dollars). */
export interface RevenueRow {
  report_date: string;
  asset_size_tier: string | null;
  overdraft_revenue: number | string;
}

export interface OdRevenue {
  /** "the second quarter of 2026" */
  quarter: string;
  banks: number;
  /** Dollars. */
  total: number;
  yearAgo: { banks: number; total: number } | null;
  /** The largest size group's banks and their share of the total. */
  largest: { label: string; banks: number; share: number } | null;
}

export interface TrackedBill {
  title: string;
  jurisdiction: string | null;
  identifier: string | null;
  stage: string | null;
  url: string | null;
}

const QUARTERS: Record<string, string> = { "03": "first", "06": "second", "09": "third", "12": "fourth" };

export function summarizeRevenue(rows: RevenueRow[]): OdRevenue | null {
  const latest = [...new Set(rows.map((row) => row.report_date))].sort().pop();
  if (!latest) return null;
  const yearAgoDate = `${Number(latest.slice(0, 4)) - 1}${latest.slice(4)}`;
  const at = (date: string) => rows.filter((row) => row.report_date === date && Number(row.overdraft_revenue) > 0);
  const sum = (list: RevenueRow[]) => list.reduce((total, row) => total + Number(row.overdraft_revenue) * 1000, 0);
  const now = at(latest);
  const before = at(yearAgoDate);
  const top = SIZE_GROUPS[SIZE_GROUPS.length - 1];
  const topRows = now.filter((row) => row.asset_size_tier && (top.tiers as readonly string[]).includes(row.asset_size_tier));
  const total = sum(now);
  return {
    quarter: `the ${QUARTERS[latest.slice(5, 7)] ?? "latest"} quarter of ${latest.slice(0, 4)}`,
    banks: now.length,
    total,
    yearAgo: before.length ? { banks: before.length, total: sum(before) } : null,
    largest: topRows.length ? { label: top.label, banks: topRows.length, share: pct(sum(topRows), total) } : null,
  };
}

/** "$1.50 billion", "$904 million". */
export function bigDollars(value: number): string {
  return value >= 1e9 ? `$${(value / 1e9).toFixed(2)} billion` : `$${Math.round(value / 1e6)} million`;
}

const cents = (value: number) => Math.round(value * 100) / 100;
const sorted = (values: Iterable<number>) => [...values].sort((a, b) => a - b);
const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

function charterTrend(charter: Charter, values: Map<number, number>, rows: OdRow[], highMark: number): CharterTrend {
  const tierOf = new Map<number, string>();
  for (const row of rows) {
    if (row.charter_type === charter && row.asset_size_tier) tierOf.set(Number(row.institution_id), row.asset_size_tier);
  }
  const groups: SizeGroup[] = [];
  for (const group of SIZE_GROUPS) {
    const list = sorted([...tierOf].filter(([, tier]) => (group.tiers as readonly string[]).includes(tier)).map(([id]) => values.get(id) ?? NaN).filter(Number.isFinite));
    if (list.length < STRONG_INSTITUTION_COUNT) continue;
    const highCount = list.filter((value) => value >= highMark).length;
    groups.push({ key: group.key, label: group.label, institutions: list.length, median: cents(computePercentile(list, 50)), highCount, highShare: pct(highCount, list.length) });
  }
  const move = groups.length >= 2 ? groups[groups.length - 1].median - groups[0].median : 0;
  return { charter, groups, direction: move >= TREND_DOLLARS ? "up" : move <= -TREND_DOLLARS ? "down" : "flat" };
}

export function summarizeOdByState(rows: OdRow[], category: string = OD_CATEGORY, related: RelatedRow[] = []): OdSummary {
  // The national figures count every institution, territories included, as the National report does.
  const values = new Map([...valuePerInstitution(rows.map((row) => ({ ...row, fee_category: category })))].map(([id, value]) => [id, cents(value)]));
  const all = sorted(values.values());
  const national =
    all.length === 0
      ? null
      : { institutions: all.length, median: cents(computePercentile(all, 50)), p25: cents(computePercentile(all, 25)), p75: cents(computePercentile(all, 75)) };

  const stateOf = new Map<number, string>();
  for (const row of rows) stateOf.set(Number(row.institution_id), row.state_code);
  const byState = new Map<string, number[]>();
  for (const [id, value] of values) {
    const code = stateOf.get(id);
    if (!code || (!US_STATES_ONLY.has(code) && code !== "DC")) continue;
    const list = byState.get(code);
    if (list) list.push(value);
    else byState.set(code, [value]);
  }
  const states: StateOd[] = [];
  let thinStates = 0;
  for (const [code, list] of byState) {
    if (list.length < STRONG_INSTITUTION_COUNT || !national) {
      thinStates += 1;
      continue;
    }
    const ordered = sorted(list);
    states.push({
      code,
      name: STATE_NAMES[code] ?? code,
      institutions: ordered.length,
      median: cents(computePercentile(ordered, 50)),
      low: ordered[0],
      high: ordered[ordered.length - 1],
      lowCount: ordered.filter((value) => value <= national.p25).length,
    });
  }
  states.sort((a, b) => a.median - b.median || a.name.localeCompare(b.name));

  const highMark = national?.p75 ?? Infinity;
  return {
    national,
    states,
    thinStates,
    banks: charterTrend("bank", values, rows, highMark),
    creditUnions: charterTrend("credit_union", values, rows, highMark),
    ...relatedFees(values, related),
  };
}

function relatedFees(values: Map<number, number>, related: RelatedRow[]): Pick<OdSummary, "transfer" | "recurring"> {
  const perInstitution = (category: string) =>
    new Map(
      [...valuePerInstitution(related.filter((row) => row.fee_category === category && values.has(Number(row.institution_id))))].map(([id, value]) => [
        id,
        cents(value),
      ]),
    );
  const transfers = perInstitution("od_protection_transfer");
  const recurring = perInstitution("continuous_od");
  const transferList = sorted(transfers.values());
  const savings = sorted([...transfers].map(([id, value]) => cents((values.get(id) ?? 0) - value)));
  const recurringList = sorted(recurring.values());
  return {
    transfer:
      transferList.length >= STRONG_INSTITUTION_COUNT
        ? {
            institutions: transferList.length,
            median: cents(computePercentile(transferList, 50)),
            savings: cents(computePercentile(savings, 50)),
            free: transferList.filter((value) => value === 0).length,
          }
        : null,
    recurring:
      recurringList.length >= STRONG_INSTITUTION_COUNT
        ? { institutions: recurringList.length, median: cents(computePercentile(recurringList, 50)) }
        : null,
  };
}

export function dollars(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function monthLabel(asOf: Date): string {
  return asOf.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function articleSlug(asOf: Date, topic: FeeTopic = OVERDRAFT_TOPIC): string {
  return `${topic.category.replace(/_/g, "-")}-fees-by-state-${asOf.toISOString().slice(0, 7)}`;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const CHARTER_PLURAL: Record<Charter, string> = { bank: "banks", credit_union: "credit unions" };
const CHARTER_TITLE: Record<Charter, string> = { bank: "Banks", credit_union: "Credit unions" };

/** "Bigger banks charge more for an overdraft." */
function trendSentence(trend: CharterTrend, chargeFor: string): string {
  const who = CHARTER_PLURAL[trend.charter];
  if (trend.direction === "up") return `Bigger ${who} charge more ${chargeFor}.`;
  if (trend.direction === "down") return `Bigger ${who} charge less ${chargeFor}.`;
  return `${CHARTER_TITLE[trend.charter]} charge about the same ${chargeFor} at every size.`;
}

export function headline(summary: OdSummary, topic: FeeTopic): string {
  const { banks, creditUnions } = summary;
  if (banks.direction === "flat" && creditUnions.direction === "flat") return `${topic.titlePlural}: the institution matters more than the state`;
  if (banks.direction !== "flat" && creditUnions.direction !== "flat" && banks.direction !== creditUnions.direction) {
    // Opposite directions: the second sentence drops the repeated "for an overdraft".
    return `${trendSentence(banks, topic.chargeFor)} Bigger credit unions charge ${creditUnions.direction === "up" ? "more" : "less"}.`;
  }
  if (banks.direction === creditUnions.direction) {
    return `The bigger the bank or credit union, the ${banks.direction === "up" ? "higher" : "lower"} the ${topic.noun}`;
  }
  return trendSentence(banks.direction !== "flat" ? banks : creditUnions, topic.chargeFor).replace(/\.$/, "");
}

function bars(title: string, groups: SizeGroup[]): string {
  return ["```bars " + title, ...groups.map((group) => `${group.label} | ${group.median} | ${dollars(group.median)}`), "```"].join("\n");
}

function sizeSection(trend: CharterTrend, topic: FeeTopic, highMark: number): string[] {
  if (trend.groups.length < 2) return [];
  const who = CHARTER_PLURAL[trend.charter];
  const one = trend.charter === "bank" ? "bank" : "credit union";
  const heading =
    trend.direction === "flat"
      ? `## ${CHARTER_TITLE[trend.charter]}: size makes little difference`
      : `## ${CHARTER_TITLE[trend.charter]}: the larger the ${one}, the ${trend.direction === "up" ? "higher" : "lower"} the fee`;
  const first = trend.groups[0];
  const last = trend.groups[trend.groups.length - 1];
  const table = [
    `| ${CHARTER_TITLE[trend.charter].replace(/s$/, "")} size (total assets) | ${CHARTER_TITLE[trend.charter]} | Median ${topic.noun} | Share charging ${dollars(highMark)} or more |`,
    "|---|---|---|---|",
    ...trend.groups.map((group) => `| ${group.label} | ${group.institutions.toLocaleString("en-US")} | ${dollars(group.median)} | ${group.highShare}% |`),
  ].join("\n");
  return [
    heading,
    bars(`Median ${topic.noun} at ${who}, by size`, trend.groups),
    table,
    `${CHARTER_TITLE[trend.charter]} ${lowerFirst(first.label)} in assets typically charge ${dollars(first.median)}; ${who} ${lowerFirst(last.label)} typically charge ${dollars(last.median)}.`,
  ];
}

/** The size group both charters fill best, for a like-for-like comparison. */
function sharedGroup(summary: OdSummary): { bank: SizeGroup; cu: SizeGroup } | null {
  let best: { bank: SizeGroup; cu: SizeGroup } | null = null;
  for (const bank of summary.banks.groups) {
    const cu = summary.creditUnions.groups.find((group) => group.key === bank.key);
    if (!cu) continue;
    if (!best || Math.min(bank.institutions, cu.institutions) > Math.min(best.bank.institutions, best.cu.institutions)) best = { bank, cu };
  }
  return best;
}

function stateLine(state: StateOd): string {
  return `| [${state.name}](${SITE_URL}/research/state/${state.code}) | ${state.institutions} | ${dollars(state.low)} | ${dollars(state.median)} | ${dollars(state.high)} |`;
}

function stateSection(summary: OdSummary, topic: FeeTopic): string[] {
  const { states, national } = summary;
  if (!national || states.length < 2) return [];
  const lowest = states[0];
  const highest = states[states.length - 1];
  const band = highest.median - lowest.median;
  const typicalRange = computePercentile(sorted(states.map((state) => state.high - state.low)), 50);
  const lines: string[] = [
    `## ${band < typicalRange ? "The state matters less than the institution" : "Where the state makes a difference"}`,
    `State medians run from ${dollars(lowest.median)} to ${dollars(highest.median)}. Inside a single state, the gap between the lowest and highest ${topic.noun} is typically ${dollars(cents(typicalRange))}.`,
  ];
  const bullets: string[] = [];
  bullets.push(
    `- **${lowest.name}** has the lowest median, ${dollars(lowest.median)}: ${lowest.lowCount} of its ${lowest.institutions} institutions charge ${dollars(national.p25)} or less. Its fees still run from ${dollars(lowest.low)} to ${dollars(lowest.high)}.`,
  );
  const largest = [...states].sort((a, b) => b.institutions - a.institutions || a.name.localeCompare(b.name))[0];
  if (largest !== lowest && largest !== highest) {
    bullets.push(`- **${largest.name}**, with the most institutions listed (${largest.institutions}), sits at ${dollars(largest.median)}, with fees from ${dollars(largest.low)} to ${dollars(largest.high)}.`);
  }
  const othersLow = Math.max(...states.filter((state) => state !== highest).map((state) => state.low));
  const floor = highest.low > othersLow ? ` It is the only listed state where no institution charges less than ${dollars(highest.low)}.` : "";
  bullets.push(`- **${highest.name}** has the highest median, ${dollars(highest.median)}.${floor}`);
  lines.push(bullets.join("\n"));
  if (lowest.high >= national.p75 && highest.low < highest.median) {
    lines.push(`So someone in a lower-fee state can still pay ${dollars(national.p75)} or more, and someone in a higher-fee state can pay far less. It depends on where they bank.`);
  }
  return lines;
}

function relatedSection(summary: OdSummary): string[] {
  const lines: string[] = [];
  if (summary.transfer) {
    const { institutions, median, savings, free } = summary.transfer;
    lines.push(
      `Of the institutions that publish an overdraft fee, ${institutions.toLocaleString("en-US")} also list a fee for an overdraft protection transfer, which covers the shortfall from savings or another linked account. There the typical transfer costs ${dollars(median)}, ${dollars(savings)} less than the overdraft fee it replaces${free > 0 ? `, and ${free} charge nothing for it` : ""}.`,
    );
  }
  if (summary.recurring) {
    lines.push(`${summary.recurring.institutions.toLocaleString("en-US")} institutions also charge a recurring fee when an account stays overdrawn, typically ${dollars(summary.recurring.median)}.`);
  }
  return lines.length ? ["## The cheaper option most schedules also list", ...lines] : [];
}

function revenueSection(revenue: OdRevenue | null | undefined): string[] {
  if (!revenue || revenue.banks === 0) return [];
  const change = revenue.yearAgo ? `, against ${bigDollars(revenue.yearAgo.total)} from ${revenue.yearAgo.banks} banks a year earlier` : "";
  const largest = revenue.largest
    ? ` The ${revenue.largest.banks} banks ${lowerFirst(revenue.largest.label)} in assets took ${revenue.largest.share}% of it.`
    : "";
  return [
    "## Who collects the revenue",
    `Banks with more than $1 billion in assets report their overdraft revenue every quarter. In ${revenue.quarter}, ${revenue.banks} of them reported ${bigDollars(revenue.total)}${change}.${largest} Credit unions stopped reporting overdraft income after 2024, so there is no matching credit union figure.`,
  ];
}

function billsSection(bills: TrackedBill[] | undefined): string[] {
  if (!bills?.length) return [];
  const line = (bill: TrackedBill) => {
    const name = [bill.identifier, bill.title].filter(Boolean).join(": ");
    const where = [bill.jurisdiction, bill.stage].filter(Boolean).join(", ");
    return `- ${bill.url ? `[${name}](${bill.url})` : name}${where ? ` (${where})` : ""}`;
  };
  return ["## Bills and rules to watch", bills.map(line).join("\n")];
}

function bankerSection(summary: OdSummary, topic: FeeTopic): string[] {
  const pair = sharedGroup(summary);
  const lines = ["## What this means for a bank or credit union"];
  const mark = dollars(summary.national?.p75 ?? 0);
  if (pair) {
    lines.push(
      `A fee is only high or low against the right comparison. At ${lowerFirst(pair.bank.label)} in assets, ${pair.bank.highShare}% of banks charge ${mark} or more for this fee; among credit unions the same size, ${pair.cu.highShare}% do. The same ${topic.noun} can be ordinary for one and unusual for the other.`,
    );
  }
  lines.push(`Before a pricing committee or a "lower fees" campaign, compare against peers by charter and size, and against the institutions in your own market.`);
  return lines;
}

function leadPattern(banks: CharterTrend, creditUnions: CharterTrend): string {
  const move = (direction: CharterTrend["direction"]) => (direction === "up" ? "more" : "less");
  if (banks.direction === "flat" && creditUnions.direction === "flat") return "Size makes little difference to what banks and credit unions charge; which institution someone uses makes a lot.";
  if (banks.direction === creditUnions.direction) return `Sort banks and credit unions by size and both charge ${move(banks.direction)} as they grow.`;
  if (banks.direction !== "flat" && creditUnions.direction !== "flat") return "Sort banks and credit unions by size and they move in opposite directions.";
  const moving = banks.direction !== "flat" ? banks : creditUnions;
  const steady = moving === banks ? creditUnions : banks;
  return `Sort them by size and ${CHARTER_PLURAL[moving.charter]} charge ${move(moving.direction)} as they grow, while ${CHARTER_PLURAL[steady.charter]} hold steady.`;
}

export interface OdArticle {
  slug: string;
  title: string;
  subtitle: string;
  content: string;
}

export function draftOdArticle(summary: OdSummary, asOf: Date, topic: FeeTopic = OVERDRAFT_TOPIC): OdArticle | null {
  if (!summary.national || summary.states.length < 2) return null;
  const { banks, creditUnions } = summary;
  if (banks.groups.length < 2 && creditUnions.groups.length < 2) return null;
  const month = monthLabel(asOf);
  const lead = `A single national number hides the pattern. ${leadPattern(banks, creditUnions)}`;
  const content = [
    lead,
    ...sizeSection(banks, topic, summary.national.p75),
    ...sizeSection(creditUnions, topic, summary.national.p75),
    ...stateSection(summary, topic),
    ...(topic.category === OD_CATEGORY ? relatedSection(summary) : []),
    ...(topic.category === OD_CATEGORY ? revenueSection(summary.revenue) : []),
    ...billsSection(summary.bills),
    ...bankerSection(summary, topic),
    `## Every state with enough data`,
    ["| State | Institutions | Lowest | Median | Highest |", "|---|---|---|---|---|", ...summary.states.map(stateLine)].join("\n"),
    `## How these numbers are built`,
    [
      `Each figure comes from the ${PRODUCT_NAME}, built from each institution's own published fee schedule. Every institution counts once. ${topic.method}`,
      `A size group or state is shown only when at least ${STRONG_INSTITUTION_COUNT} institutions in it publish the fee; ${summary.thinStates} states had fewer and are left out of the state list. Sizes use each institution's latest reported total assets. Business-only schedules are left out.`,
      `To see every fee for a state, open its [state fee report](${SITE_URL}/research). To compare one institution with its peers, look it up [here](${SITE_URL}/institutions).`,
    ].join("\n\n"),
    `As of ${month}.`,
  ].join("\n\n");
  return {
    slug: articleSlug(asOf, topic),
    title: headline(summary, topic),
    subtitle: `What ${summary.national.institutions.toLocaleString("en-US")} published fee schedules say about the ${topic.noun}, by institution size and by state. ${month}.`,
    content,
  };
}

/** Every number the article may carry. */
export function allowedOdNumbers(summary: OdSummary, asOf: Date): Set<string> {
  const values: Array<number | string> = [STRONG_INSTITUTION_COUNT, summary.thinStates, summary.states.length, asOf.getUTCFullYear(), 0, ...SIZE_LABEL_NUMBERS];
  const money = (value: number) => values.push(value, dollars(value).slice(1));
  if (summary.national) {
    values.push(summary.national.institutions);
    [summary.national.median, summary.national.p25, summary.national.p75].forEach(money);
  }
  for (const state of summary.states) {
    values.push(state.institutions, state.lowCount);
    [state.median, state.low, state.high].forEach(money);
  }
  if (summary.states.length) money(cents(computePercentile(sorted(summary.states.map((state) => state.high - state.low)), 50)));
  for (const trend of [summary.banks, summary.creditUnions]) {
    for (const group of trend.groups) {
      values.push(group.institutions, group.highShare);
      money(group.median);
    }
  }
  if (summary.transfer) {
    values.push(summary.transfer.institutions, summary.transfer.free);
    [summary.transfer.median, summary.transfer.savings].forEach(money);
  }
  if (summary.recurring) {
    values.push(summary.recurring.institutions);
    money(summary.recurring.median);
  }
  const revenue = summary.revenue;
  if (revenue) {
    // "$1 billion" is the Call Report's reporting line; the quarter's year comes from the report date.
    values.push(revenue.banks, bigDollars(revenue.total).slice(1).split(" ")[0], revenue.quarter.replace(/\D/g, ""));
    if (revenue.yearAgo) values.push(revenue.yearAgo.banks, bigDollars(revenue.yearAgo.total).slice(1).split(" ")[0]);
    if (revenue.largest) values.push(revenue.largest.banks, revenue.largest.share);
    values.push(2024);
  }
  // Bill numbers and dates come from the tracker's own titles, not our statistics.
  for (const bill of summary.bills ?? []) values.push(...(`${bill.identifier ?? ""} ${bill.title} ${bill.stage ?? ""}`.match(/\d[\d,]*(?:\.\d+)?/g) ?? []));
  return new Set(values.map(String));
}

/** The article text the number check reads: link targets and chart values are dropped, chart labels kept. */
export function checkedText(article: OdArticle): string {
  const content = article.content
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/```bars ([^\n]*)\n([\s\S]*?)\n```/g, (_block, title: string, body: string) =>
      [title, ...body.split("\n").map((line) => line.replace(/^(.+) \| [\d.]+ \| (.+)$/, "$1 $2"))].join("\n"),
    );
  return `${article.title}\n${article.subtitle}\n${content}`;
}

export async function loadOdRows(db: SqlTag = sql, category: string = OD_CATEGORY): Promise<OdRow[]> {
  const rows = await db.unsafe(
    `SELECT ef.institution_id, s.state_code, s.charter_type, s.asset_size_tier, ef.amount
       FROM published_fee_catalog ef
       JOIN institution_sources s ON s.id = ef.institution_id
      WHERE ${STATS_ROW_FILTER}
        AND ef.fee_category = $1
        AND ef.amount IS NOT NULL AND ef.amount >= 0
        AND s.state_code IS NOT NULL`,
    [category],
  );
  return rows as unknown as OdRow[];
}

/** Overdraft's related fees: the protection transfer and the recurring fee for staying overdrawn. */
export async function loadRelatedRows(db: SqlTag = sql): Promise<RelatedRow[]> {
  const rows = await db.unsafe(
    `SELECT ef.institution_id, ef.fee_category, ef.amount
       FROM published_fee_catalog ef
      WHERE ${STATS_ROW_FILTER}
        AND ef.fee_category = ANY($1::text[])
        AND ef.amount IS NOT NULL AND ef.amount >= 0`,
    [["od_protection_transfer", "continuous_od"]],
  );
  return rows as unknown as RelatedRow[];
}

/** Bank overdraft revenue for the latest Call Report quarter and the same quarter a year earlier. */
export async function loadRevenueRows(db: SqlTag = sql): Promise<RevenueRow[]> {
  const rows = await db`
    WITH latest AS (
      SELECT max(report_date) AS d FROM institution_financial_records
       WHERE source = 'fdic' AND overdraft_revenue IS NOT NULL
    )
    SELECT f.report_date, s.asset_size_tier, f.overdraft_revenue
      FROM institution_financial_records f
      JOIN latest ON true
      LEFT JOIN institution_sources s ON s.id = f.institution_id
     WHERE f.source = 'fdic'
       AND f.overdraft_revenue > 0
       AND (f.report_date = latest.d OR f.report_date = to_char(latest.d::date - interval '1 year', 'YYYY-MM-DD'))
  `;
  return rows as unknown as RevenueRow[];
}

/** The newest tracked bills and rules whose title or summary names this fee. */
export async function loadTrackedBills(db: SqlTag, topic: FeeTopic, limit = 8): Promise<TrackedBill[]> {
  const patterns = topic.lawKeywords.map((word) => `%${word}%`);
  const rows = await db`
    SELECT title, jurisdiction, identifier, stage, url
      FROM reg_tracker_items
     WHERE title ILIKE ANY(${patterns}) OR abstract ILIKE ANY(${patterns})
     ORDER BY COALESCE(stage_on, published_on) DESC NULLS LAST
     LIMIT ${limit}
  `;
  return rows as unknown as TrackedBill[];
}

/** The first topic in FEE_TOPICS whose article for this month isn't written yet. */
export function nextTopic(existingSlugs: Set<string>, asOf: Date): FeeTopic | null {
  return FEE_TOPICS.find((topic) => !existingSlugs.has(articleSlug(asOf, topic))) ?? null;
}

export interface OdByStateResult {
  schemaReady: boolean;
  dryRun: boolean;
  category: string | null;
  statesListed: number;
  nationalMedian: number | null;
  slug: string | null;
  articleId: number | null;
  draftId: number | null;
  /** Unedited drafts from this month rewritten with current numbers. */
  refreshed: string[];
  reason: string | null;
}

interface ExistingArticle {
  id: number | string;
  slug: string;
  status: string;
  generated_by: string | null;
  untouched: boolean;
}

/** Builds and checks one topic's article; a string is the reason it can't be written. */
async function buildArticle(db: SqlTag, topic: FeeTopic, now: Date): Promise<{ article: OdArticle; summary: OdSummary } | string> {
  const related = topic.category === OD_CATEGORY ? await loadRelatedRows(db) : [];
  const summary = summarizeOdByState(await loadOdRows(db, topic.category), topic.category, related);
  summary.revenue = topic.category === OD_CATEGORY ? summarizeRevenue(await loadRevenueRows(db)) : null;
  summary.bills = await loadTrackedBills(db, topic);
  const article = draftOdArticle(summary, now, topic);
  if (!article) return `too few institutions with ${topic.noun} data to compare by size and state`;
  const unbacked = unbackedNumbers(checkedText(article), allowedOdNumbers(summary, now));
  if (unbacked.length) return `article carries numbers not in the facts: ${unbacked.join(", ")}`;
  return { article, summary };
}

export async function runOdByState(input: { db?: SqlTag; runId: number | null; now?: Date; dryRun: boolean }): Promise<OdByStateResult> {
  const db = input.db ?? sql;
  const now = input.now ?? new Date();
  const base: OdByStateResult = { schemaReady: false, dryRun: input.dryRun, category: null, statesListed: 0, nationalMedian: null, slug: null, articleId: null, draftId: null, refreshed: [], reason: null };
  if (!(await contentSchemaReady(db))) return { ...base, reason: "content_drafts table is missing" };

  const slugs = FEE_TOPICS.map((topic) => articleSlug(now, topic));
  const existing = (await db`
    SELECT id, slug, status, generated_by, (updated_at = created_at) AS untouched
      FROM research_articles WHERE slug = ANY(${slugs})
  `) as unknown as ExistingArticle[];

  // A draft of ours that nobody has edited or published is rewritten with current numbers.
  const refreshed: string[] = [];
  for (const row of existing) {
    if (row.status !== "draft" || row.generated_by !== AUTHOR_TAG || !row.untouched) continue;
    const topic = FEE_TOPICS.find((candidate) => articleSlug(now, candidate) === row.slug);
    if (!topic) continue;
    const built = await buildArticle(db, topic, now);
    if (typeof built === "string" || input.dryRun) continue;
    await db`
      UPDATE research_articles
         SET title = ${built.article.title}, subtitle = ${built.article.subtitle}, content = ${built.article.content},
             created_at = now(), updated_at = now()
       WHERE id = ${Number(row.id)} AND status = 'draft' AND updated_at = created_at
    `;
    await db`
      UPDATE content_drafts SET title = ${built.article.title}
       WHERE workflow = ${OD_BY_STATE_WORKFLOW} AND subject_key = ${row.slug} AND status = 'draft'
    `;
    refreshed.push(row.slug);
  }
  const ready = { ...base, schemaReady: true, refreshed };

  const [{ lately }] = await db`
    SELECT count(*)::int AS lately FROM content_drafts
     WHERE workflow = ${OD_BY_STATE_WORKFLOW} AND created_at >= now() - make_interval(days => ${CADENCE_DAYS}::int)
  `;
  if (Number(lately) > 0) return { ...ready, reason: "drafted one this week already; this article runs weekly" };
  const topic = nextTopic(new Set(existing.map((row) => String(row.slug))), now);
  if (!topic) return { ...ready, reason: "every fee article for this month is written" };

  const built = await buildArticle(db, topic, now);
  const result: OdByStateResult = { ...ready, category: topic.category, slug: articleSlug(now, topic) };
  if (typeof built === "string") return { ...result, reason: built };
  const { article, summary } = built;
  const done = { ...result, statesListed: summary.states.length, nationalMedian: summary.national?.median ?? null };
  if (input.dryRun) return { ...done, reason: "dry run: nothing written" };

  const [row] = await db`
    INSERT INTO research_articles (slug, title, subtitle, content, category, tags, author, generated_by)
    VALUES (${article.slug}, ${article.title}, ${article.subtitle}, ${article.content}, 'analysis',
            ${JSON.stringify([topic.category, "states", "size"])}, ${RESEARCH_IMPRINT}, ${AUTHOR_TAG})
    RETURNING id
  `;
  const articleId = Number(row.id);
  const draftId = await insertContentDraft(
    {
      agent: "ernest",
      kind: "article",
      channel: "site",
      workflow: OD_BY_STATE_WORKFLOW,
      subjectKey: article.slug,
      title: article.title,
      caption: `${article.subtitle}\n\nThe article is a draft. Read and publish it at ${SITE_URL}/admin/hamilton/research/articles; it goes live at ${SITE_URL}/research/articles/${article.slug}.`,
      facts: {
        kind: "article",
        article_id: articleId,
        slug: article.slug,
        fee_category: topic.category,
        national: summary.national,
        banks: summary.banks,
        credit_unions: summary.creditUnions,
        transfer: summary.transfer,
        recurring: summary.recurring,
        states: summary.states,
        thin_states: summary.thinStates,
        method: `published_fee_catalog, sourced consumer rows only; one value per institution (overdraft at its highest tier, others at their middle amount); $0 counts; a size group or state needs ${STRONG_INSTITUTION_COUNT}+ institutions; "high" is the national 75th percentile`,
      },
      asOf: now,
      agentRunId: input.runId,
    },
    db,
  );
  return { ...done, articleId, draftId };
}

export function summarizeOdByStateResult(result: OdByStateResult): string {
  if (!result.schemaReady) return "Content queue table is missing; nothing drafted.";
  const refreshed = result.refreshed.length ? ` Rewrote ${result.refreshed.length} unedited draft${result.refreshed.length === 1 ? "" : "s"} with current numbers (${result.refreshed.join(", ")}).` : "";
  if (result.draftId !== null) {
    return `Drafted a fee article (${result.slug}): ${result.statesListed} states, national median ${dollars(result.nationalMedian ?? 0)}.${refreshed}`;
  }
  return `No new fee article drafted (${result.reason ?? "unknown"}).${refreshed}`;
}

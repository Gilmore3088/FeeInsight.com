import { sql } from "@/lib/data-store/connection";
import { computePercentile } from "@/lib/data-store/fees";
import { STATS_ROW_FILTER, valuePerInstitution } from "@/lib/data-store/fee-stats";
import { contentSchemaReady, insertContentDraft, recentSubjects } from "@/lib/data-store/content-drafts";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { SITE_DOMAIN } from "@/lib/constants";
import { unbackedNumbers } from "@/lib/agents/marketing/facts";
import { themeFees } from "./calendar";
import { checkSpreadEnds } from "./end-check";

/**
 * W1 market spread (weekly, free, no model). Finds the metro where one of this month's
 * theme fees varies most between local banks and credit unions, and drafts a LinkedIn
 * caption plus the numbers for its card into the content queue. Never posts.
 *
 * Statistics follow the fee-stats contract: sourced rows only, one value per
 * institution (overdraft at its highest tier), $0 counts. Institutions are never named.
 */

type SqlTag = typeof sql;

export const MARKET_SPREAD_WORKFLOW = "w1-market-spread";
/** Fewest institutions a metro needs before its spread is a story. */
export const MIN_MARKET_INSTITUTIONS = 10;
/** Smallest low-to-high gap worth a post. */
export const MIN_SPREAD_DOLLARS = 10;
/** A metro and fee featured within this many days is not picked again. */
export const REPEAT_WINDOW_DAYS = 56;

export interface MarketSpread {
  feeCategory: string;
  metro: string;
  institutions: number;
  low: number;
  high: number;
  p25: number;
  median: number;
  p75: number;
  zeros: number;
  /** Every institution's value, lowest first, unnamed (for the card's dot strip). */
  values: number[];
}

export interface MarketRow {
  institution_id: number | string;
  cbsa_name: string;
  fee_category: string;
  amount: number | string | null;
}

const cents = (value: number) => Math.round(value * 100) / 100;

/** One spread per metro and fee, from sourced rows, one value per institution. */
export function summarizeMarkets(rows: MarketRow[]): MarketSpread[] {
  const groups = new Map<string, MarketRow[]>();
  for (const row of rows) {
    const key = `${row.fee_category}\u0000${row.cbsa_name}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const spreads: MarketSpread[] = [];
  for (const [key, list] of groups) {
    const [feeCategory, metro] = key.split("\u0000");
    const values = [...valuePerInstitution(list).values()].map(cents).sort((a, b) => a - b);
    if (values.length === 0) continue;
    spreads.push({
      feeCategory,
      metro,
      institutions: values.length,
      low: values[0],
      high: values[values.length - 1],
      p25: cents(computePercentile(values, 25)),
      median: cents(computePercentile(values, 50)),
      p75: cents(computePercentile(values, 75)),
      zeros: values.filter((value) => value === 0).length,
      values,
    });
  }
  return spreads;
}

export function subjectKey(spread: Pick<MarketSpread, "feeCategory" | "metro">): string {
  return `${spread.feeCategory}:${spread.metro}`;
}

/** Why a spread can't be posted, or null when it can. */
export function refusal(spread: MarketSpread): string | null {
  if (spread.institutions < MIN_MARKET_INSTITUTIONS) return `only ${spread.institutions} institutions`;
  if (spread.high - spread.low < MIN_SPREAD_DOLLARS) return `spread under $${MIN_SPREAD_DOLLARS}`;
  return null;
}

/**
 * The postable spread with the widest middle half (a real difference between typical
 * local prices, not one outlier), then the widest full range, then the most institutions.
 */
export function rankMarkets(spreads: MarketSpread[], recent: Set<string>): MarketSpread[] {
  const eligible = spreads.filter((spread) => refusal(spread) === null && !recent.has(subjectKey(spread)));
  return eligible.sort(
    (a, b) =>
      b.p75 - b.p25 - (a.p75 - a.p25) ||
      b.high - b.low - (a.high - a.low) ||
      b.institutions - a.institutions ||
      a.metro.localeCompare(b.metro),
  );
}

export function pickMarket(spreads: MarketSpread[], recent: Set<string>): MarketSpread | null {
  return rankMarkets(spreads, recent)[0] ?? null;
}

/** Spreads tried, best first, before the run gives up on ends that won't trace. */
export const END_CHECK_TRIES = 5;

export function money(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/** "Miami-Fort Lauderdale-Pompano Beach, FL" -> "Miami, FL". */
export function metroLabel(cbsa: string): string {
  const [cities, states = ""] = cbsa.split(", ");
  const city = cities.split("-")[0].trim();
  const state = states.split("-")[0].trim();
  return state ? `${city}, ${state}` : city;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function asOfLabel(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** Every content caption ends on the free report, not a Hamilton page. */
export const FREE_REPORT_CTA = "Get a free fee report:";
const FREE_REPORT_URL = `https://${SITE_DOMAIN}/reports`;

/** The free reports page, tagged with the workflow and draft it came from. */
export function freeReportLink(campaign: string, content: string): string {
  return `${FREE_REPORT_URL}?utm_source=linkedin&utm_medium=social&utm_campaign=${campaign}&utm_content=${content}`;
}

/** The caption: the number-guarded body, then the free-report call to action and its link. */
export function captionWithCta(body: string, link: string): string {
  return `${body}\n\n${FREE_REPORT_CTA} ${link}`;
}

export function trackedLink(feeCategory: string, asOf: Date): string {
  const week = asOf.toISOString().slice(0, 10);
  return freeReportLink(MARKET_SPREAD_WORKFLOW, `${feeCategory}-${week}`);
}

export interface MarketSpreadDraft {
  title: string;
  /** Caption text, guarded: every number in it is one of the spread's facts or the date. */
  body: string;
  link: string;
  caption: string;
}

export function draftCaption(spread: MarketSpread, asOf: Date): MarketSpreadDraft {
  const fee = getDisplayName(spread.feeCategory);
  const place = metroLabel(spread.metro);
  const zeros = spread.zeros > 0 ? `, and ${spread.zeros} charge nothing` : "";
  const body = [
    `${fee} fees in the ${place} area run from ${money(spread.low)} to ${money(spread.high)}.`,
    `${spread.institutions} local banks and credit unions publish this fee. The middle half charge between ${money(spread.p25)} and ${money(spread.p75)}${zeros}.`,
    `Same fee, same market, a ${money(cents(spread.high - spread.low))} difference. Where does yours sit? Hamilton shows any institution's fee against its local competitors, its peers, its state and its Fed district.`,
    `Source: the Bank Fee Index, built from each institution's own published fee schedule. As of ${asOfLabel(asOf)}.`,
  ].join("\n\n");
  const link = trackedLink(spread.feeCategory, asOf);
  return {
    title: `${fee} in ${place}: ${money(spread.low)} to ${money(spread.high)}`,
    body,
    link,
    caption: captionWithCta(body, link),
  };
}

/** Numbers the caption may use: the spread's own figures and the as-of date. */
export function allowedNumbers(spread: MarketSpread, asOf: Date): Set<string> {
  const figures = [spread.low, spread.high, spread.p25, spread.p75, spread.median, spread.institutions, spread.zeros, cents(spread.high - spread.low)];
  const allowed = new Set<string>();
  for (const figure of figures) {
    allowed.add(String(figure));
    allowed.add(figure.toFixed(2));
  }
  allowed.add(String(asOf.getUTCDate()));
  allowed.add(String(asOf.getUTCFullYear()));
  return allowed;
}

export interface MarketSpreadResult {
  schemaReady: boolean;
  dryRun: boolean;
  fees: string[];
  marketsConsidered: number;
  postable: number;
  skippedRecent: number;
  /** Spreads passed over because an end institution's value did not trace to its schedule. */
  endsRejected: Array<{ fee: string; metro: string; failing: number; checked: number }>;
  draftId: number | null;
  picked: { fee: string; metro: string; institutions: number; low: number; high: number } | null;
  reason: string | null;
}

export async function loadMarketRows(fees: string[], db: SqlTag = sql): Promise<MarketRow[]> {
  const rows = await db.unsafe(
    `SELECT ef.institution_id, s.cbsa_name, ef.fee_category, ef.amount
       FROM published_fee_catalog ef
       JOIN institution_sources s ON s.id = ef.institution_id
      WHERE ${STATS_ROW_FILTER}
        AND ef.amount IS NOT NULL AND ef.amount >= 0
        AND s.cbsa_name IS NOT NULL
        AND ef.fee_category = ANY($1::text[])`,
    [fees],
  );
  return rows as unknown as MarketRow[];
}

export async function runMarketSpread(input: { db?: SqlTag; runId: number | null; now?: Date; dryRun: boolean }): Promise<MarketSpreadResult> {
  const db = input.db ?? sql;
  const now = input.now ?? new Date();
  const fees = themeFees(now);
  const base: MarketSpreadResult = {
    schemaReady: false,
    dryRun: input.dryRun,
    fees,
    marketsConsidered: 0,
    postable: 0,
    skippedRecent: 0,
    endsRejected: [],
    draftId: null,
    picked: null,
    reason: null,
  };
  if (!(await contentSchemaReady(db))) return { ...base, reason: "content_drafts table is missing" };

  const marketRows = await loadMarketRows(fees, db);
  const spreads = summarizeMarkets(marketRows);
  const recent = await recentSubjects(MARKET_SPREAD_WORKFLOW, REPEAT_WINDOW_DAYS, db);
  const postable = spreads.filter((spread) => refusal(spread) === null);
  const result: MarketSpreadResult = {
    ...base,
    schemaReady: true,
    marketsConsidered: spreads.length,
    postable: postable.length,
    skippedRecent: postable.filter((spread) => recent.has(subjectKey(spread))).length,
    endsRejected: [],
  };
  const ranked = rankMarkets(spreads, recent);
  if (ranked.length === 0) return { ...result, reason: "no metro passed the checks this week" };
  let pick: MarketSpread | null = null;
  for (const candidate of ranked.slice(0, END_CHECK_TRIES)) {
    const ends = await checkSpreadEnds(db, marketRows, candidate);
    if (ends.failing.length === 0) {
      pick = candidate;
      break;
    }
    result.endsRejected.push({ fee: candidate.feeCategory, metro: candidate.metro, failing: ends.failing.length, checked: ends.checked });
  }
  if (!pick) return { ...result, reason: `the low or high end didn't trace to its own schedule in the top ${result.endsRejected.length} metros` };

  const draft = draftCaption(pick, now);
  const unbacked = unbackedNumbers(draft.body, allowedNumbers(pick, now));
  const picked = { fee: pick.feeCategory, metro: pick.metro, institutions: pick.institutions, low: pick.low, high: pick.high };
  if (unbacked.length) return { ...result, picked, reason: `caption carries numbers not in the facts: ${unbacked.join(", ")}` };
  if (input.dryRun) return { ...result, picked, reason: "dry run: nothing written" };

  const draftId = await insertContentDraft(
    {
      workflow: MARKET_SPREAD_WORKFLOW,
      subjectKey: subjectKey(pick),
      title: draft.title,
      caption: draft.caption,
      facts: {
        ...pick,
        fee_label: getDisplayName(pick.feeCategory),
        metro_label: metroLabel(pick.metro),
        method: "published_fee_catalog, sourced rows only, one value per institution (overdraft at its highest tier), $0 counts; the low and high ends traced to each institution's own schedule",
        link: draft.link,
      },
      asOf: now,
      agentRunId: input.runId,
    },
    db,
  );
  return { ...result, picked, draftId };
}

export function summarizeMarketSpread(result: MarketSpreadResult): string {
  if (!result.schemaReady) return "Content queue table is missing; nothing drafted.";
  if (result.draftId !== null && result.picked) {
    return `Drafted a market-spread post: ${getDisplayName(result.picked.fee)} in ${metroLabel(result.picked.metro)}, ${money(result.picked.low)} to ${money(result.picked.high)} across ${result.picked.institutions} institutions${result.endsRejected.length ? `; passed over ${result.endsRejected.length} whose low or high end did not trace to its schedule` : ""}.`;
  }
  return `No market-spread post drafted (${result.reason ?? "unknown"}); ${result.postable} of ${result.marketsConsidered} metros passed the checks.`;
}

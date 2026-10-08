import { isFeeHeadline, splitPublisher } from "@/lib/regulatory/state-news";
import { sql } from "./connection";

/**
 * State-level news for the Pro news page and the State report: the state regulators' own
 * posts (registry-state-reg-news, reg_articles source "state:XX"), press coverage of state
 * fee bills (registry-state-bill-news, source "news:XX") and the state's fee bills
 * (registry-state-bills, reg_tracker_items source "open_states"). Kept apart from the
 * federal release readers (FEDERAL_RELEASES_ONLY in ./news), and always labelled as what
 * it is: a press story is never presented as a regulator's release.
 */

export interface StateRegulatorPost {
  state_code: string;
  title: string;
  link: string;
  published_at: string | null;
  /** The headline names a fee and a bank or credit union. */
  fee_related: boolean;
}

export interface StatePressStory {
  state_code: string;
  headline: string;
  /** The outlet, from Google News' "Headline - Publisher" title. */
  publisher: string | null;
  link: string;
  published_at: string | null;
}

export interface StateFeeBill {
  state_code: string;
  identifier: string | null;
  title: string;
  stage: string | null;
  stage_on: string | null;
  url: string | null;
}

/** Open States bill stages in plain words (state legislatures, not Congress). */
export const STATE_BILL_STAGE_LABELS: Record<string, string> = {
  introduced: "Introduced",
  in_committee: "In committee",
  passed_chamber: "Passed one chamber",
  passed_legislature: "Passed the legislature",
  signed: "Signed into law",
  vetoed: "Vetoed",
  failed: "Failed",
};

export interface StateNews {
  regulator_posts: StateRegulatorPost[];
  press: StatePressStory[];
  bills: StateFeeBill[];
}

export interface StateNewsOptions {
  /** Two-letter state code; omit for every state. */
  stateCode?: string | null;
  /** ISO date; items published before it are left out. Bills use their latest action date. */
  since?: string | null;
  limit?: number;
}

interface ArticleRow {
  source: string;
  title: string;
  link: string;
  published_at: string | null;
}

interface BillRow {
  jurisdiction: string;
  identifier: string | null;
  title: string;
  stage: string | null;
  stage_on: string | Date | null;
  url: string | null;
}

function isoDay(value: string | Date | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function stateOf(source: string): string {
  return source.slice(source.indexOf(":") + 1).toUpperCase();
}

const BANKING_WORDS =
  /\bbank|credit union|deposit|\blend|\bloan|mortgage|financ|money|\bfees?\b|overdraft|scam|fraud|payment|crypto|virtual currency|stablecoin|settle|consent order|cease and desist|commissioner|consumer alert|licens|servicer|savings|ombuds|bulletin/i;
const OTHER_DEPARTMENT_WORDS =
  /(?<!deposit )insurance|cannabis|construction|hiring|job service|jobs in|apprenticeship|workforce|layoff|emissions|solar|health|medical|weather|holiday schedule|holidays-for-year/i;

/**
 * Several states publish one feed for a whole department (labor, commerce, insurance and
 * banking together), so a regulator post is shown only when its headline is about banking,
 * lending, money or consumer finance and not another division's business.
 */
export function isBankingPost(title: string): boolean {
  return BANKING_WORDS.test(title) && !OTHER_DEPARTMENT_WORDS.test(title);
}

/** Banking posts only, fee headlines first, then newest first. */
export function toRegulatorPosts(rows: ArticleRow[]): StateRegulatorPost[] {
  return rows
    .filter((r) => isBankingPost(r.title))
    .map((r) => ({
      state_code: stateOf(r.source),
      title: r.title,
      link: r.link,
      published_at: isoDay(r.published_at),
      fee_related: isFeeHeadline(r.title),
    }))
    .sort((a, b) => Number(b.fee_related) - Number(a.fee_related) || (b.published_at ?? "").localeCompare(a.published_at ?? ""));
}

export function toPressStories(rows: ArticleRow[]): StatePressStory[] {
  return rows.map((r) => {
    const { headline, publisher } = splitPublisher(r.title);
    return { state_code: stateOf(r.source), headline, publisher, link: r.link, published_at: isoDay(r.published_at) };
  });
}

export function toFeeBills(rows: BillRow[]): StateFeeBill[] {
  return rows.map((r) => ({
    state_code: String(r.jurisdiction).toUpperCase(),
    identifier: r.identifier ?? null,
    title: r.title,
    stage: r.stage ?? null,
    stage_on: isoDay(r.stage_on),
    url: r.url ?? null,
  }));
}

async function readArticles(prefix: "state" | "news", options: StateNewsOptions, limit: number): Promise<ArticleRow[]> {
  const pattern = options.stateCode ? `${prefix}:${options.stateCode.toUpperCase()}` : `${prefix}:%`;
  const since = options.since ?? null;
  return (await sql`
    SELECT source, title, link, published_at
      FROM reg_articles
     WHERE source LIKE ${pattern}
       AND (${since}::text IS NULL OR published_at >= ${since})
     ORDER BY published_at DESC NULLS LAST, created_at DESC
     LIMIT ${limit}
  `) as unknown as ArticleRow[];
}

async function readBills(options: StateNewsOptions, limit: number): Promise<BillRow[]> {
  const state = options.stateCode ? options.stateCode.toUpperCase() : null;
  const since = options.since ?? null;
  return (await sql`
    SELECT jurisdiction, identifier, title, stage, stage_on, url
      FROM reg_tracker_items
     WHERE source = 'open_states'
       AND cardinality(topics) > 0
       AND (${state}::text IS NULL OR jurisdiction = ${state})
       AND (${since}::date IS NULL OR COALESCE(stage_on, published_on) >= ${since}::date)
     ORDER BY COALESCE(stage_on, published_on) DESC NULLS LAST
     LIMIT ${limit}
  `) as unknown as BillRow[];
}

/** Each part reads on its own, so a missing table empties that part rather than the rest. */
export async function getStateNews(options: StateNewsOptions = {}): Promise<StateNews> {
  const limit = options.limit ?? 50;
  const empty = <T,>(label: string) => (error: unknown): T[] => {
    console.error(`[state-news] ${label} read failed`, error);
    return [];
  };
  const [posts, press, bills] = await Promise.all([
    // Read extra posts: department-wide feeds lose many to the banking filter.
    readArticles("state", options, limit * 4).catch(empty<ArticleRow>("regulator posts")),
    readArticles("news", options, limit).catch(empty<ArticleRow>("press stories")),
    readBills(options, limit).catch(empty<BillRow>("fee bills")),
  ]);
  return { regulator_posts: toRegulatorPosts(posts).slice(0, limit), press: toPressStories(press), bills: toFeeBills(bills) };
}

/** States with at least one stored item, for the news page's state picker. */
export async function getStatesWithNews(): Promise<string[]> {
  try {
    const rows = (await sql`
      SELECT DISTINCT upper(split_part(source, ':', 2)) AS state_code FROM reg_articles WHERE source LIKE 'state:%' OR source LIKE 'news:%'
      UNION
      SELECT DISTINCT upper(jurisdiction) FROM reg_tracker_items WHERE source = 'open_states' AND cardinality(topics) > 0
      ORDER BY 1
    `) as unknown as { state_code: string }[];
    return rows.map((r) => r.state_code).filter(Boolean);
  } catch {
    return [];
  }
}

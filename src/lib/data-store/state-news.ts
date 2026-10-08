import { isFeeHeadline, splitPublisher } from "@/lib/regulatory/state-news";
import { likePattern, type WireKind } from "@/lib/regulatory/wire";
import { hasFeeType, type FeeType } from "@/lib/regulatory/wire-fee-types";
import { trackerItemId } from "@/lib/regulatory/wire-research";
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
  /** reg_articles.guid, the key of the item's research note; absent on older readers. */
  guid?: string;
  state_code: string;
  title: string;
  link: string;
  published_at: string | null;
  /** The headline names a fee and a bank or credit union. */
  fee_related: boolean;
}

export interface StatePressStory {
  /** reg_articles.guid; absent on older readers. */
  guid?: string;
  state_code: string;
  headline: string;
  /** The outlet, from Google News' "Headline - Publisher" title. */
  publisher: string | null;
  link: string;
  published_at: string | null;
}

export interface StateFeeBill {
  /** reg_tracker_items "source:external_id", the key of the bill's research note; absent on older readers. */
  tracker_id?: string;
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
  guid?: string;
  source: string;
  title: string;
  link: string;
  published_at: string | null;
}

export interface BillRow {
  source?: string;
  external_id?: string;
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
const AGENCY_NAMES =
  /(department|division|office) of (financial services|financial institutions|banking)/gi;
const OTHER_DEPARTMENT_WORDS =
  /(?<!deposit )insurance|nysif|injured workers|cannabis|construction|hiring|job service|jobs in|apprenticeship|workforce|layoff|emissions|solar|health|medical|weather|holiday schedule|holidays-for-year/i;

/**
 * Several states publish one feed for a whole department (labor, commerce, insurance and
 * banking together), so a regulator post is shown only when its headline is about banking,
 * lending, money or consumer finance and not another division's business.
 */
export function isBankingPost(title: string): boolean {
  // The agency's own name ("Department of Financial Services Announces ...") says nothing
  // about the post, so it is taken out before looking for banking words.
  const topic = title.replace(AGENCY_NAMES, " ");
  return BANKING_WORDS.test(topic) && !OTHER_DEPARTMENT_WORDS.test(title);
}

/** Banking posts only, fee headlines first, then newest first. */
export function toRegulatorPosts(rows: ArticleRow[]): StateRegulatorPost[] {
  return rows
    .filter((r) => isBankingPost(r.title))
    .map((r) => ({
      ...(r.guid ? { guid: r.guid } : {}),
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
    return {
      ...(r.guid ? { guid: r.guid } : {}),
      state_code: stateOf(r.source),
      headline,
      publisher,
      link: r.link,
      published_at: isoDay(r.published_at),
    };
  });
}

export function toFeeBills(rows: BillRow[]): StateFeeBill[] {
  return rows.map((r) => ({
    ...(r.source && r.external_id ? { tracker_id: trackerItemId(r.source, r.external_id) } : {}),
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

// ---------------------------------------------------------------------------
// The Regulatory Wire's States view: one chronological, paged, searchable feed
// ---------------------------------------------------------------------------

/**
 * Most candidate rows a part reads for one window. The state parts hold hundreds of rows, so
 * a part normally reads all of its window; when one reaches this cap its count is a floor
 * and the page says so (`capped`).
 */
export const STATE_WIRE_READ_CAP = 5000;

export interface StateWireBill extends StateFeeBill {
  /** When the bill was introduced (reg_tracker_items.published_on). */
  introduced_on: string | null;
}

export type StateWireItem =
  | ({ kind: "regulator"; date: string | null } & StateRegulatorPost)
  | ({ kind: "press"; date: string | null } & StatePressStory)
  | ({ kind: "bill"; date: string | null } & StateWireBill);

export interface StateWireCounts {
  bills: number;
  regulators: number;
  press: number;
}

export interface StateWirePage {
  items: StateWireItem[];
  /** Items of the chosen kind(s) in the window, after the banking filter. */
  total: number;
  /** The offset actually used: a page past the end shows the last page. */
  offset: number;
  /** Each kind's count in the window, whatever the kind filter. */
  counts: StateWireCounts;
  /** Parts whose read failed: their counts are 0 because nothing could be read, not because nothing is stored. */
  failed: WireKind[];
  /** Parts that reached STATE_WIRE_READ_CAP: their counts are at least the number shown. */
  capped: WireKind[];
}

export interface StateWireOptions {
  stateCode?: string | null;
  kind?: WireKind | null;
  /** ISO timestamp or day; bills use their latest action date (or introduction date). */
  since?: string | null;
  /** Case-insensitive title search; a bill's number matches too. */
  q?: string | null;
  /** Fee-type tag from the headline (wire-fee-types); absent means every item. */
  fee?: FeeType | null;
  limit?: number;
  offset?: number;
}

export interface StateWireParts {
  regulators: StateRegulatorPost[];
  press: StatePressStory[];
  bills: StateWireBill[];
}

const KIND_ORDER: Record<StateWireItem["kind"], number> = { bill: 0, regulator: 1, press: 2 };

/**
 * Merges the three parts newest first and cuts one page. The parts arrive already filtered
 * (regulator posts through isBankingPost), so `total` and `counts` are what the reader can
 * actually page through. Undated items go last. Ties keep official items ahead of press.
 */
export function mergeStateWire(
  parts: StateWireParts,
  options: { kind?: WireKind | null; limit?: number; offset?: number } = {},
): Pick<StateWirePage, "items" | "total" | "offset" | "counts"> {
  const limit = Math.max(1, options.limit ?? 25);
  const counts: StateWireCounts = {
    bills: parts.bills.length,
    regulators: parts.regulators.length,
    press: parts.press.length,
  };
  const all: StateWireItem[] = [];
  if (!options.kind || options.kind === "bills") {
    for (const b of parts.bills) all.push({ kind: "bill", date: b.stage_on ?? b.introduced_on, ...b });
  }
  if (!options.kind || options.kind === "regulators") {
    for (const p of parts.regulators) all.push({ kind: "regulator", date: p.published_at, ...p });
  }
  if (!options.kind || options.kind === "press") {
    for (const s of parts.press) all.push({ kind: "press", date: s.published_at, ...s });
  }
  all.sort((a, b) => {
    if (a.date !== b.date) {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    }
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });
  const total = all.length;
  const lastPageOffset = total === 0 ? 0 : Math.floor((total - 1) / limit) * limit;
  const offset = Math.min(Math.max(0, options.offset ?? 0), lastPageOffset);
  return { items: all.slice(offset, offset + limit), total, offset, counts };
}

/** Keeps the items whose headline carries this fee type; every item when none is chosen. */
export function filterStateWireByFee(parts: StateWireParts, fee: FeeType | null): StateWireParts {
  if (!fee) return parts;
  return {
    bills: parts.bills.filter((b) => hasFeeType(b.title, fee)),
    regulators: parts.regulators.filter((p) => hasFeeType(p.title, fee)),
    press: parts.press.filter((s) => hasFeeType(s.headline, fee)),
  };
}

export interface WireBillRow extends BillRow {
  published_on: string | Date | null;
}

async function readWireArticles(prefix: "state" | "news", options: StateWireOptions, cap: number): Promise<ArticleRow[]> {
  const pattern = options.stateCode ? `${prefix}:${options.stateCode.toUpperCase()}` : `${prefix}:%`;
  const since = options.since ?? null;
  const q = likePattern(options.q);
  return (await sql`
    SELECT guid, source, title, link, published_at
      FROM reg_articles
     WHERE source LIKE ${pattern}
       AND (${since}::text IS NULL OR published_at >= ${since})
       AND (${q}::text IS NULL OR title ILIKE ${q})
     ORDER BY published_at DESC NULLS LAST, created_at DESC
     LIMIT ${cap}
  `) as unknown as ArticleRow[];
}

async function readWireBills(options: StateWireOptions, cap: number): Promise<WireBillRow[]> {
  const state = options.stateCode ? options.stateCode.toUpperCase() : null;
  const since = options.since ?? null;
  const q = likePattern(options.q);
  return (await sql`
    SELECT source, external_id, jurisdiction, identifier, title, stage, stage_on, url, published_on
      FROM reg_tracker_items
     WHERE source = 'open_states'
       AND cardinality(topics) > 0
       AND (${state}::text IS NULL OR jurisdiction = ${state})
       AND (${since}::date IS NULL OR COALESCE(stage_on, published_on) >= ${since}::date)
       AND (${q}::text IS NULL OR title ILIKE ${q} OR identifier ILIKE ${q})
     ORDER BY COALESCE(stage_on, published_on) DESC NULLS LAST
     LIMIT ${cap}
  `) as unknown as WireBillRow[];
}

/** Bill rows with their introduction date kept for the feed's ordering. */
export function toWireBills(rows: WireBillRow[]): StateWireBill[] {
  return toFeeBills(rows).map((bill, i) => ({ ...bill, introduced_on: isoDay(rows[i].published_on) }));
}

/**
 * One page of the States view. Each part reads every candidate row in the window (state,
 * since and search applied in SQL), the banking filter runs on the regulator posts, and the
 * merged list is paged in memory, so the total, the per-kind counts and the page numbers all
 * count the same filtered rows. A part that fails is reported in `failed` and the others
 * still show. Unlike getStateNews (the State report's reader), fee posts are not put first.
 */
export async function getStateWire(options: StateWireOptions = {}): Promise<StateWirePage> {
  const cap = STATE_WIRE_READ_CAP;
  const failed: WireKind[] = [];
  const capped: WireKind[] = [];
  const part = <T,>(kind: WireKind, read: () => Promise<T[]>): Promise<T[]> =>
    read().then(
      (rows) => {
        if (rows.length >= cap) capped.push(kind);
        return rows;
      },
      (error: unknown) => {
        console.error(`[state-news] wire ${kind} read failed`, error);
        failed.push(kind);
        return [] as T[];
      },
    );
  const [posts, press, bills] = await Promise.all([
    part("regulators", () => readWireArticles("state", options, cap)),
    part("press", () => readWireArticles("news", options, cap)),
    part("bills", () => readWireBills(options, cap)),
  ]);
  const parts = filterStateWireByFee(
    { regulators: toRegulatorPosts(posts), press: toPressStories(press), bills: toWireBills(bills) },
    options.fee ?? null,
  );
  const page = mergeStateWire(
    parts,
    { kind: options.kind, limit: options.limit, offset: options.offset },
  );
  const order: WireKind[] = ["bills", "regulators", "press"];
  const inOrder = (list: WireKind[]) => order.filter((k) => list.includes(k));
  return { ...page, failed: inOrder(failed), capped: inOrder(capped) };
}

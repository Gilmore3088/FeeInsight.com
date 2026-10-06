/**
 * Regulatory and industry developments for the National and State reports.
 *
 * Reads the agency press releases Magellan's news feed stores in reg_articles (Federal
 * Reserve, FDIC, OCC, CFPB). Releases are sorted into a few kinds by their title,
 * calendar notices are dropped, and a joint release that several agencies each post is
 * shown once with every agency named. Nothing is summarized or rewritten: each item is
 * the agency's own title, date and link.
 *
 * Also reads confirmed fee changes at the same banks (the Monthly Pulse rule) for the
 * report window, and the state's banking regulator for the State report.
 */

import { getSql } from "@/lib/data-store/connection";
import { loadConfirmedFeeChanges, type PulseChange } from "./monthly-pulse";

/** Days of releases and fee changes a report covers. */
export const DEVELOPMENTS_WINDOW_DAYS = 90;

export type DevelopmentKind = "consumer" | "rulemaking" | "enforcement" | "structure" | "industry";

export const DEVELOPMENT_KIND_LABELS: Record<DevelopmentKind, string> = {
  consumer: "Consumer protection and fees",
  rulemaking: "Rules, guidance and supervision",
  enforcement: "Enforcement actions",
  structure: "Mergers, applications and bank failures",
  industry: "Industry data, policy and remarks",
};

/** Kinds in the order a report shows them. */
export const DEVELOPMENT_KIND_ORDER: DevelopmentKind[] = ["consumer", "rulemaking", "enforcement", "structure", "industry"];

export const AGENCY_LABELS: Record<string, string> = {
  FED: "Federal Reserve",
  FDIC: "FDIC",
  OCC: "OCC",
  CFPB: "CFPB",
};

export interface DevelopmentItem {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Agency codes (FED, FDIC, OCC, CFPB); more than one for a joint release. */
  agencies: string[];
  title: string;
  link: string;
  kind: DevelopmentKind;
}

export interface DevelopmentsBlock {
  window_start: string;
  window_end: string;
  window_days: number;
  items: DevelopmentItem[];
  /** Releases per agency in the window (a joint release counts for each agency). */
  by_agency: Array<{ agency: string; count: number }>;
  /** When the feed last stored a release, so a stale feed is visible. */
  last_fetched: string | null;
}

export interface FeeChangesBlock {
  window_start: string;
  window_days: number;
  changes: PulseChange[];
  /** Recorded changes left out because the newest schedule does not bear them out. */
  not_confirmed: number;
}

export interface StateRegulatorRef {
  agency_name: string;
  website_url: string | null;
  credit_union_agency_name: string | null;
  credit_union_website_url: string | null;
}

export interface RawReleaseRow {
  source: string;
  title: string;
  link: string;
  topic: string | null;
  published_at: string | null;
  created_at?: string | Date | null;
}

// ─── Pure rules ───────────────────────────────────────────────────────────────

/** Calendar and procedural notices: not developments. */
const NOISE = /sunshine act|board of directors meeting|minutes of the board's discount rate|opens registration|workshop|webinar/i;

const ENFORCEMENT = /enforcement (action|order)|consent order|civil money penalt|cease and desist|prohibition order/i;
const STRUCTURE = /approval of application|application by|merger|acquisition|acquires|assumes all deposits|bank failure|failed bank|de novo|deposit insurance application/i;
const CONSUMER = /overdraft|\bnsf\b|\bfees?\b|junk fee|consumer|complaint|financial literacy|deposit account|fair lending|\budaap?\b|reg(ulation)? e\b/i;
const RULEMAKING = /propos|final rule|\brules?\b|guidance|comment period|seek(s)? comment|request(s)? (public )?comment|regulation|framework|burden|exam|supervis|\bcra\b|resolution plan|stress test|capital/i;
const INDUSTRY = /quarter|net income|return on assets|summary of deposits|survey|performance|trading revenue|fomc|economic projections|interest rate|beige book/i;

/** The kind of a release from its title, or null for a calendar or procedural notice. */
export function classifyRelease(title: string, source: string, topic?: string | null): DevelopmentKind | null {
  if (NOISE.test(title)) return null;
  if (ENFORCEMENT.test(title)) return "enforcement";
  if (STRUCTURE.test(title) || topic === "mergers_acquisitions") return "structure";
  if (source === "CFPB" || CONSUMER.test(title) || topic === "overdraft" || topic === "fees_pricing") return "consumer";
  if (RULEMAKING.test(title) || topic === "rulemaking_compliance") return "rulemaking";
  if (INDUSTRY.test(title)) return "industry";
  return "industry";
}

/** "Press Release: Agencies Seek Comment ..." and "Agencies seek comment ..." are one release. */
export function releaseKey(title: string): string {
  return title
    .replace(/^press release:\s*/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function cleanTitle(title: string): string {
  return title.replace(/^press release:\s*/i, "").trim();
}

/**
 * Releases in [start, end] as development items, newest first. A joint release posted by
 * several agencies on the same day is one item naming each agency.
 */
export function buildDevelopments(rows: RawReleaseRow[], windowStart: string, windowEnd: string): DevelopmentItem[] {
  const byKey = new Map<string, DevelopmentItem>();
  for (const row of rows) {
    const date = isoDate(row.published_at);
    if (!date || date < windowStart || date > windowEnd) continue;
    const kind = classifyRelease(row.title, row.source, row.topic);
    if (!kind) continue;
    const key = `${date}|${releaseKey(row.title)}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.agencies.includes(row.source)) existing.agencies.push(row.source);
      continue;
    }
    byKey.set(key, { date, agencies: [row.source], title: cleanTitle(row.title), link: row.link, kind });
  }
  return [...byKey.values()].sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : a.date < b.date ? 1 : -1));
}

export function countByAgency(items: DevelopmentItem[]): Array<{ agency: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) for (const a of item.agencies) counts.set(a, (counts.get(a) ?? 0) + 1);
  return [...counts.entries()].map(([agency, count]) => ({ agency, count })).sort((a, b) => b.count - a.count || a.agency.localeCompare(b.agency));
}

/** Items whose title names the state (the State report's "names this state" list). */
export function itemsNamingState(items: DevelopmentItem[], stateName: string): DevelopmentItem[] {
  const pattern = new RegExp(`\\b${stateName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return items.filter((i) => pattern.test(i.title));
}

// ─── Reads ────────────────────────────────────────────────────────────────────

function windowFor(now: Date, days: number): { start: string; end: string } {
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { start, end };
}

export async function loadDevelopments(now = new Date(), days = DEVELOPMENTS_WINDOW_DAYS): Promise<DevelopmentsBlock> {
  const sql = getSql();
  const { start, end } = windowFor(now, days);
  // published_at is stored as text; ISO strings compare correctly, and buildDevelopments
  // re-checks each date after parsing.
  const rows = (await sql.unsafe(
    `SELECT source, title, link, topic, published_at, created_at
       FROM reg_articles
      WHERE published_at >= $1
      ORDER BY published_at DESC`,
    [start],
  )) as unknown as RawReleaseRow[];
  const [fetched] = (await sql.unsafe(`SELECT MAX(created_at) AS last_fetched FROM reg_articles`)) as unknown as Array<{
    last_fetched: string | Date | null;
  }>;
  const items = buildDevelopments(rows, start, end);
  const last = fetched?.last_fetched ?? null;
  return {
    window_start: start,
    window_end: end,
    window_days: days,
    items,
    by_agency: countByAgency(items),
    last_fetched: last instanceof Date ? last.toISOString() : last,
  };
}

export async function loadFeeChanges(now = new Date(), days = DEVELOPMENTS_WINDOW_DAYS): Promise<FeeChangesBlock> {
  const { start } = windowFor(now, days);
  const { changes, recorded } = await loadConfirmedFeeChanges(`${start}T00:00:00.000Z`);
  return { window_start: start, window_days: days, changes, not_confirmed: recorded - changes.length };
}

export async function loadStateRegulator(stateCode: string): Promise<StateRegulatorRef | null> {
  const sql = getSql();
  const rows = (await sql.unsafe(
    `SELECT agency_name, website_url, credit_union_agency_name, credit_union_website_url
       FROM state_regulators WHERE state_code = $1`,
    [stateCode.toUpperCase()],
  )) as unknown as StateRegulatorRef[];
  return rows[0] ?? null;
}

async function orNull<T>(label: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    console.error(`[developments] ${label} read failed; the report section says so`, error);
    return null;
  }
}

/** Fee changes, agency releases and the state regulator for the State report. */
export async function loadStateReportContext(
  stateCode: string,
  now = new Date(),
): Promise<{ feeChanges: FeeChangesBlock | null; developments: DevelopmentsBlock | null; regulator: StateRegulatorRef | null }> {
  const [feeChanges, developments, regulator] = await Promise.all([
    orNull("fee changes", () => loadFeeChanges(now)),
    orNull("agency releases", () => loadDevelopments(now)),
    orNull("state regulator", () => loadStateRegulator(stateCode)),
  ]);
  return { feeChanges, developments, regulator };
}

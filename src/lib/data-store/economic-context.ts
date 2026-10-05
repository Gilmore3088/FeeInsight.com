import { sql } from "./connection";
import { getBeigeBookThemes, getLatestBeigeBook } from "./fed";

/**
 * Economic and regulatory context for a state report, read from the tables the registry
 * steps already keep fresh: fed_beige_book (+ beige_book_themes), fed_economic_indicators
 * (FRED and BLS series) and reg_articles. Nothing here fetches from outside.
 */

export interface IndicatorPoint {
  date: string;
  value: number;
}

export interface IndicatorSeries {
  series_id: string;
  latest: IndicatorPoint;
  /** The observation 12 months before the latest, when the series has one. */
  year_ago: IndicatorPoint | null;
  /** Oldest first, for a sparkline. */
  history: IndicatorPoint[];
}

export interface BeigeBookContext {
  release_date: string;
  source_url: string | null;
  summary: string;
  /** The district's banking / financial services section, when the edition has one. */
  banking: { section_name: string; text: string } | null;
  themes: { category: string; sentiment: string; summary: string }[];
}

export interface RegulatoryItem {
  source: string;
  title: string;
  link: string;
  topic: string;
  published_at: string | null;
}

export interface StateEconomicContext {
  state_unemployment: IndicatorSeries | null;
  state_payrolls: IndicatorSeries | null;
  fed_funds: IndicatorSeries | null;
  cpi_all_items: IndicatorSeries | null;
  cpi_bank_services: IndicatorSeries | null;
  beige_book: BeigeBookContext | null;
  regulatory: RegulatoryItem[];
}

const HISTORY_POINTS = 25;
const REGULATORY_TOPICS = ["overdraft", "fees_pricing", "rulemaking_compliance", "consumer_lending"];
const REGULATORY_LIMIT = 5;
const BANKING_SECTION = /bank|financ|credit|lending|loan/i;

function isIsoDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function toDateString(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

/** Shape raw newest-first rows into a series; null when there are no usable values. */
export function buildIndicatorSeries(seriesId: string, rows: { observation_date: unknown; value: unknown }[]): IndicatorSeries | null {
  const points = rows
    .map((r) => ({ date: toDateString(r.observation_date), value: Number(r.value) }))
    .filter((p) => Number.isFinite(p.value) && isIsoDate(p.date));
  if (points.length === 0) return null;
  const latest = points[0];
  const target = new Date(`${latest.date}T00:00:00Z`);
  target.setUTCFullYear(target.getUTCFullYear() - 1);
  const yearAgoDate = target.toISOString().slice(0, 10);
  const yearAgo = points.find((p) => p.date === yearAgoDate) ?? null;
  return { series_id: seriesId, latest, year_ago: yearAgo, history: points.slice(0, HISTORY_POINTS).reverse() };
}


async function loadSeries(seriesIds: string[]): Promise<Map<string, IndicatorSeries>> {
  const rows = await sql`
    SELECT series_id, observation_date, value
      FROM (
        SELECT series_id, observation_date, value,
               ROW_NUMBER() OVER (PARTITION BY series_id ORDER BY observation_date DESC) AS rn
          FROM fed_economic_indicators
         WHERE series_id = ANY(${seriesIds}::text[]) AND value IS NOT NULL
      ) ranked
     WHERE rn <= ${HISTORY_POINTS}
     ORDER BY series_id, observation_date DESC
  ` as { series_id: string; observation_date: unknown; value: unknown }[];
  const bySeries = new Map<string, { observation_date: unknown; value: unknown }[]>();
  for (const row of rows) {
    const list = bySeries.get(row.series_id) ?? [];
    list.push(row);
    bySeries.set(row.series_id, list);
  }
  const out = new Map<string, IndicatorSeries>();
  for (const [id, list] of bySeries) {
    const series = buildIndicatorSeries(id, list);
    if (series) out.set(id, series);
  }
  return out;
}

async function loadBeigeBook(district: number): Promise<BeigeBookContext | null> {
  const [sections, themes] = await Promise.all([getLatestBeigeBook(district), getBeigeBookThemes()]);
  if (sections.length === 0) return null;
  const summary = sections.find((s) => s.section_name === "Summary of Economic Activity") ?? sections[0];
  const banking = sections.find((s) => s !== summary && BANKING_SECTION.test(s.section_name));
  return {
    release_date: summary.release_date,
    source_url: summary.source_url || null,
    summary: summary.content_text,
    banking: banking ? { section_name: banking.section_name, text: banking.content_text } : null,
    themes: themes
      .filter((t) => t.fed_district === district && t.release_code === summary.release_code)
      .map((t) => ({ category: t.theme_category, sentiment: t.sentiment, summary: t.summary })),
  };
}

async function loadRegulatory(): Promise<RegulatoryItem[]> {
  try {
    const rows = await sql`
      SELECT source, title, link, topic, published_at
        FROM reg_articles
       WHERE topic = ANY(${REGULATORY_TOPICS}::text[])
       ORDER BY published_at DESC NULLS LAST, created_at DESC
       LIMIT ${REGULATORY_LIMIT}
    ` as RegulatoryItem[];
    return rows.map((r) => ({ ...r, published_at: r.published_at ? String(r.published_at) : null }));
  } catch {
    // The feed table is optional context; a missing table hides the list.
    return [];
  }
}

export async function getStateEconomicContext(stateCode: string, district: number | null): Promise<StateEconomicContext> {
  const unemploymentId = `${stateCode}UR`;
  const payrollId = `${stateCode}NA`;
  const [series, beigeBook, regulatory] = await Promise.all([
    loadSeries([unemploymentId, payrollId, "FEDFUNDS", "CPIAUCSL", "CUUR0000SEMC01", "CUUR0000SA0"]),
    district ? loadBeigeBook(district) : Promise.resolve(null),
    loadRegulatory(),
  ]);
  return {
    state_unemployment: series.get(unemploymentId) ?? null,
    state_payrolls: series.get(payrollId) ?? null,
    fed_funds: series.get("FEDFUNDS") ?? null,
    cpi_all_items: series.get("CUUR0000SA0") ?? series.get("CPIAUCSL") ?? null,
    cpi_bank_services: series.get("CUUR0000SEMC01") ?? null,
    beige_book: beigeBook,
    regulatory,
  };
}

export function isEmptyEconomicContext(ctx: StateEconomicContext): boolean {
  return (
    !ctx.state_unemployment && !ctx.state_payrolls && !ctx.fed_funds && !ctx.cpi_all_items &&
    !ctx.cpi_bank_services && !ctx.beige_book && ctx.regulatory.length === 0
  );
}

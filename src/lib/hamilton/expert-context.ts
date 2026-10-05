/**
 * The banking-expert context around an institution's fees on the Benchmark page:
 * its state (the state expert, the state regulator, and state medians from published
 * fees), its Federal Reserve district (the latest Beige Book summary), and recent
 * fee-relevant regulatory news. Read-only and deterministic: every line is a stored
 * fact with its date, never generated text.
 */

import { sql } from "@/lib/data-store/connection";
import { getArticles, SOURCE_LABELS, TOPIC_LABELS } from "@/lib/data-store/news";
import { ALL_TIERS, loadStatePeerLevels, PEER_MIN_INSTITUTIONS } from "@/lib/agents/state-expert/memory";
import { stateExpertFor } from "@/lib/agents/state-expert/roster";
import { STATE_REGULATORS } from "@/lib/regulatory/state-regulators";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";

export interface StateMedian {
  median: number;
  p25: number;
  p75: number;
  count: number;
}

export interface ExpertStateContext {
  stateCode: string;
  stateName: string;
  expertName: string | null;
  expertBio: string | null;
  regulator: string | null;
  regulatorUrl: string | null;
  /** Set only where credit unions are chartered by a different agency than banks. */
  creditUnionRegulator: string | null;
  /** State-wide medians by fee category, only where at least PEER_MIN_INSTITUTIONS publish the fee. */
  medians: Record<string, StateMedian>;
}

export interface ExpertDistrictContext {
  district: number;
  name: string;
  beigeBook: { text: string; releaseDate: string } | null;
}

export interface ExpertRegulatoryItem {
  title: string;
  link: string;
  source: string;
  topic: string;
  publishedAt: string | null;
}

export interface HamiltonExpertContext {
  state: ExpertStateContext | null;
  district: ExpertDistrictContext | null;
  regulation: ExpertRegulatoryItem[];
}

/** Topics that bear on fee pricing, most relevant first. */
const FEE_TOPICS = ["overdraft", "fees_pricing", "rulemaking_compliance"] as const;

export async function fetchStateContext(stateCode: string): Promise<ExpertStateContext | null> {
  const code = stateCode.trim().toUpperCase();
  const stateName = STATE_NAMES[code];
  if (!stateName) return null;
  const expert = stateExpertFor(code);
  const regulator = STATE_REGULATORS.find((entry) => entry.stateCode === code) ?? null;
  const levels = await loadStatePeerLevels(sql, code).catch(() => []);
  const medians: Record<string, StateMedian> = {};
  for (const level of levels) {
    if (level.tier !== ALL_TIERS || level.count < PEER_MIN_INSTITUTIONS) continue;
    medians[level.canonicalFeeKey] = { median: level.median, p25: level.p25, p75: level.p75, count: level.count };
  }
  return {
    stateCode: code,
    stateName,
    expertName: expert?.name ?? null,
    expertBio: expert?.bio ?? null,
    regulator: regulator?.agency ?? null,
    regulatorUrl: regulator?.website ?? null,
    creditUnionRegulator: regulator?.creditUnionAgency ?? null,
    medians,
  };
}

export async function fetchDistrictContext(district: number): Promise<ExpertDistrictContext | null> {
  const name = DISTRICT_NAMES[district];
  if (!name) return null;
  const [row] = await sql`
    SELECT content_text, release_date
      FROM fed_beige_book
     WHERE fed_district = ${district} AND section_name = 'Summary of Economic Activity'
     ORDER BY release_date DESC
     LIMIT 1
  `.catch(() => []);
  const text = row ? beigeBookSummary(String(row.content_text ?? "")) : "";
  return {
    district,
    name,
    beigeBook: text
      ? {
          text,
          releaseDate: row.release_date instanceof Date ? row.release_date.toISOString().slice(0, 10) : String(row.release_date),
        }
      : null,
  };
}

/** The opening sentences of a Beige Book summary, whole sentences only, about two lines. */
export function beigeBookSummary(content: string, maxLength = 280): string {
  const sentences = content.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  let text = "";
  for (const sentence of sentences) {
    const next = text ? `${text} ${sentence}` : sentence;
    if (text && next.length > maxLength) break;
    text = next;
  }
  return text;
}

export async function fetchRegulatoryContext(limit = 3): Promise<ExpertRegulatoryItem[]> {
  const articles = await getArticles({ limit: 60 }).catch(() => []);
  const rank = (topic: string) => {
    const index = (FEE_TOPICS as readonly string[]).indexOf(topic);
    return index === -1 ? FEE_TOPICS.length : index;
  };
  return articles
    .filter((article) => rank(article.topic) < FEE_TOPICS.length)
    .sort((a, b) => rank(a.topic) - rank(b.topic) || (toIso(b.published_at) ?? "").localeCompare(toIso(a.published_at) ?? ""))
    .slice(0, limit)
    .map((article) => ({
      title: article.title,
      link: article.link,
      source: SOURCE_LABELS[article.source] ?? article.source,
      topic: TOPIC_LABELS[article.topic] ?? article.topic,
      publishedAt: toIso(article.published_at),
    }));
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

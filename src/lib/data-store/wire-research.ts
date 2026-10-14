import {
  RELATED_WINDOW_DAYS,
  relatedBillsForPress,
  relatedFederal,
  relatedPressForBill,
  researchKey,
  trackerItemId,
  type BillForLink,
  type LinkCandidate,
  type PressForLink,
  type RelatedItem,
  type ResearchActionType,
  type ResearchItemKind,
  type ResearchNote,
  type ResearchStatus,
} from "@/lib/regulatory/wire-research";
import { sql } from "./connection";
import { FEDERAL_RELEASES_ONLY } from "./news";

/**
 * Reads for the Regulatory Wire's research panels: the notes Magellan's
 * registry-wire-research step wrote (reg_wire_research), and the deterministic related
 * items (no model): federal releases and Federal Register rules sharing a docket, rule name
 * or institution within 90 days, and press stories that name a bill. Every read fails soft:
 * a missing table or a failed query gives no notes or links, never a broken page.
 */

interface NoteRow {
  item_kind: ResearchItemKind;
  item_id: string;
  status: ResearchStatus;
  reason: string | null;
  summary: string | null;
  action_type: ResearchActionType | null;
  comment_deadline: string | Date | null;
  effective_date: string | Date | null;
  why_it_matters: string | null;
  dockets: string[] | null;
  source_url: string;
  model: string | null;
  created_at: string | Date | null;
}

function isoDay(value: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function toResearchNote(row: NoteRow): ResearchNote {
  return {
    itemKind: row.item_kind,
    itemId: row.item_id,
    status: row.status,
    reason: row.reason,
    summary: row.summary,
    actionType: row.action_type,
    commentDeadline: isoDay(row.comment_deadline),
    effectiveDate: isoDay(row.effective_date),
    whyItMatters: row.why_it_matters,
    dockets: row.dockets ?? [],
    sourceUrl: row.source_url,
    model: row.model,
    createdAt: isoDay(row.created_at),
  };
}

/** Notes for these items, keyed by researchKey(kind, id). */
export async function getResearchNotes(refs: Array<{ kind: ResearchItemKind; id: string }>): Promise<Map<string, ResearchNote>> {
  const out = new Map<string, ResearchNote>();
  const articleIds = refs.filter((r) => r.kind === "article").map((r) => r.id);
  const trackerIds = refs.filter((r) => r.kind === "tracker").map((r) => r.id);
  if (articleIds.length + trackerIds.length === 0) return out;
  try {
    const rows = (await sql`
      SELECT item_kind, item_id, status, reason, summary, action_type, comment_deadline, effective_date,
             why_it_matters, dockets, source_url, model, created_at
        FROM reg_wire_research
       WHERE (item_kind = 'article' AND item_id = ANY(${articleIds}::text[]))
          OR (item_kind = 'tracker' AND item_id = ANY(${trackerIds}::text[]))
    `) as unknown as NoteRow[];
    for (const row of rows) out.set(researchKey(row.item_kind, row.item_id), toResearchNote(row));
  } catch (error) {
    console.error("[wire-research] note read failed", error);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Federal view: related releases and rules
// ---------------------------------------------------------------------------

/** Most rows read for one page's related-item window. */
const RELATED_READ_CAP = 3000;

export interface FederalArticleRef {
  guid: string;
  source: string;
  title: string;
  link: string;
  published_at: string | null;
}

function windowFor(dates: Array<string | null>): { from: string; to: string } | null {
  const days = dates.map((d) => isoDay(d)).filter((d): d is string => Boolean(d)).sort();
  if (days.length === 0) return null;
  const shift = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
  return { from: shift(days[0], -RELATED_WINDOW_DAYS), to: shift(days[days.length - 1], RELATED_WINDOW_DAYS + 1) };
}

/**
 * Related items for each federal release on the page: other federal releases and Federal
 * Register rules within 90 days that share a docket (from the title or the note's source
 * text), a rule name or an institution. Keyed by guid.
 */
export async function getFederalRelated(articles: FederalArticleRef[]): Promise<Map<string, RelatedItem[]>> {
  const out = new Map<string, RelatedItem[]>();
  const win = windowFor(articles.map((a) => a.published_at));
  if (!win) return out;
  const candidates: LinkCandidate[] = [];
  try {
    const rows = (await sql.unsafe(
      `SELECT a.guid, a.source, a.title, a.link, a.published_at, r.dockets
         FROM reg_articles a
         LEFT JOIN reg_wire_research r ON r.item_kind = 'article' AND r.item_id = a.guid
        WHERE ${FEDERAL_RELEASES_ONLY.replace(/source/g, "a.source")}
          AND a.published_at >= $1 AND a.published_at < $2
        ORDER BY a.published_at DESC
        LIMIT $3`,
      [win.from, win.to, RELATED_READ_CAP],
    )) as unknown as Array<FederalArticleRef & { dockets: string[] | null }>;
    for (const r of rows) {
      candidates.push({ key: r.guid, kind: "release", source: r.source, title: r.title, url: r.link, date: isoDay(r.published_at), dockets: r.dockets ?? [] });
    }
  } catch (error) {
    // Without reg_wire_research the join fails; read the releases alone.
    try {
      const rows = (await sql.unsafe(
        `SELECT guid, source, title, link, published_at FROM reg_articles
          WHERE ${FEDERAL_RELEASES_ONLY} AND published_at >= $1 AND published_at < $2
          ORDER BY published_at DESC LIMIT $3`,
        [win.from, win.to, RELATED_READ_CAP],
      )) as unknown as FederalArticleRef[];
      for (const r of rows) candidates.push({ key: r.guid, kind: "release", source: r.source, title: r.title, url: r.link, date: isoDay(r.published_at) });
    } catch (inner) {
      console.error("[wire-research] related release read failed", error, inner);
    }
  }
  try {
    const rules = (await sql`
      SELECT source, external_id, title, url, agencies, dockets, published_on
        FROM reg_tracker_items
       WHERE source = 'federal_register'
         AND published_on >= ${win.from}::date AND published_on < ${win.to}::date
       ORDER BY published_on DESC
       LIMIT ${RELATED_READ_CAP}
    `) as unknown as Array<{ source: string; external_id: string; title: string; url: string; agencies: string[] | null; dockets: string[] | null; published_on: string | Date }>;
    for (const r of rules) {
      candidates.push({
        key: trackerItemId(r.source, r.external_id),
        kind: "rule",
        source: (r.agencies ?? []).join(", ") || "Federal Register",
        title: r.title,
        url: r.url,
        date: isoDay(r.published_on),
        dockets: r.dockets ?? [],
      });
    }
  } catch (error) {
    console.error("[wire-research] related rule read failed", error);
  }
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  for (const a of articles) {
    const self = byKey.get(a.guid) ?? { key: a.guid, kind: "release" as const, source: a.source, title: a.title, url: a.link, date: isoDay(a.published_at) };
    const related = relatedFederal(self, candidates);
    if (related.length > 0) out.set(a.guid, related);
  }
  return out;
}

// ---------------------------------------------------------------------------
// States view: bills and their press coverage
// ---------------------------------------------------------------------------

export interface StateBillRef {
  key: string;
  state: string;
  identifier: string | null;
  title: string;
  url: string | null;
  date: string | null;
}

export interface StatePressRef {
  key: string;
  state: string;
  /** The stored Google News title, publisher included. */
  title: string;
  url: string;
  date: string | null;
}

/**
 * Related items for the States page: each bill's press coverage and each press story's
 * bill, matched by bill number or distinctive title words (relatedPressForBill). Reads the
 * other side for the page's states only. Keyed by the item's key.
 */
export async function getStateRelated(bills: StateBillRef[], press: StatePressRef[]): Promise<Map<string, RelatedItem[]>> {
  const out = new Map<string, RelatedItem[]>();
  const billStates = [...new Set(bills.map((b) => b.state))];
  const pressStates = [...new Set(press.map((p) => p.state))];
  const [storedPress, storedBills] = await Promise.all([
    billStates.length === 0
      ? Promise.resolve([] as PressForLink[])
      : (sql`
          SELECT guid, source, title, link, published_at
            FROM reg_articles
           WHERE source = ANY(${billStates.map((s) => `news:${s}`)}::text[])
           ORDER BY published_at DESC NULLS LAST
           LIMIT ${RELATED_READ_CAP}
        ` as unknown as Promise<Array<{ guid: string; source: string; title: string; link: string; published_at: string | null }>>)
          .then((rows) => rows.map((r) => ({ key: r.guid, state: r.source.slice(5).toUpperCase(), title: r.title, url: r.link, date: isoDay(r.published_at) })))
          .catch((error: unknown) => {
            console.error("[wire-research] related press read failed", error);
            return [] as PressForLink[];
          }),
    pressStates.length === 0
      ? Promise.resolve([] as BillForLink[])
      : (sql`
          SELECT source, external_id, jurisdiction, identifier, title, url, COALESCE(stage_on, published_on) AS date
            FROM reg_tracker_items
           WHERE source = 'open_states' AND cardinality(topics) > 0
             AND jurisdiction = ANY(${pressStates}::text[])
           ORDER BY COALESCE(stage_on, published_on) DESC NULLS LAST
           LIMIT ${RELATED_READ_CAP}
        ` as unknown as Promise<Array<{ source: string; external_id: string; jurisdiction: string; identifier: string | null; title: string; url: string | null; date: string | Date | null }>>)
          .then((rows) =>
            rows.map((r) => ({
              key: trackerItemId(r.source, r.external_id),
              state: String(r.jurisdiction).toUpperCase(),
              identifier: r.identifier,
              title: r.title,
              url: r.url,
              date: isoDay(r.date),
            })),
          )
          .catch((error: unknown) => {
            console.error("[wire-research] related bill read failed", error);
            return [] as BillForLink[];
          }),
  ]);
  for (const b of bills) {
    const related = relatedPressForBill(b, storedPress);
    if (related.length > 0) out.set(b.key, related);
  }
  for (const p of press) {
    const related = relatedBillsForPress(p, storedBills);
    if (related.length > 0) out.set(p.key, related);
  }
  return out;
}

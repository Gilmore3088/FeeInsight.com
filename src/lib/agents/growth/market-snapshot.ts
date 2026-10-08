import { sql } from "@/lib/data-store/connection";
import { MIN_INSTITUTIONS_FOR_MEDIAN, STATS_ROW_FILTER, valuePerInstitution } from "@/lib/data-store/fee-stats";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { median } from "@/lib/hamilton/fee-scenario";

/**
 * The free market snapshot a prospect's first email links to (GTM plan, James 15:25 and 15:33
 * UTC Oct 8): one institution's published fees beside the other institutions in its local
 * market (same CBSA), every figure linked to the schedule it was read from. Standardized and
 * generated from the catalog, the same layout for every institution.
 *
 * A figure counts as verified only when every catalog row behind it states that amount in its
 * stored source text (`checkFeeAgainstSource`, the one shared accuracy check). A source link
 * alone is not proof. Anything else is shown labeled unverified and is left out of the local
 * median. The rows' own conditions, account type and waiver wording ride along so a reader
 * (and James, auditing the first emails) can see when two fees are not like for like.
 */

type SqlTag = typeof sql;

/** The fees a snapshot compares, overdraft first because the first email leads with it. */
export const SNAPSHOT_FEE_KEYS = [
  "overdraft",
  "nsf",
  "monthly_maintenance",
  "atm_non_network",
  "stop_payment",
  "wire_domestic_outgoing",
] as const;

/** A local median needs as many verified institutions as any other median on the site. */
export const SNAPSHOT_MIN_PEERS = MIN_INSTITUTIONS_FOR_MEDIAN;

export interface SnapshotInstitution {
  id: number;
  name: string;
  city: string | null;
  stateCode: string | null;
  cbsaCode: string | null;
  cbsaName: string | null;
  charterType: string | null;
}

export interface SnapshotFeeRow {
  institution_id: number | string;
  fee_category: string;
  fee_name: string;
  amount: number | string;
  canonical_fee_key: string | null;
  conditions: string | null;
  account_product_type: string | null;
  waiver_text: string | null;
  document_url: string | null;
  /** When the schedule was last read, not its effective date. */
  read_at: string | Date | null;
  normalized_text: string | null;
}

export interface SnapshotValue {
  institutionId: number;
  value: number;
  verified: boolean;
  /** The schedule line the value was traced to, when verified. */
  sourceLine: string | null;
  documentUrl: string | null;
  readAt: string | null;
  /** Conditions, account type and waiver wording from the rows behind the value. */
  notes: string[];
}

export interface SnapshotFee {
  category: string;
  subject: SnapshotValue | null;
  peers: SnapshotValue[];
  verifiedPeerCount: number;
  /** Median of the verified peers' values; null below SNAPSHOT_MIN_PEERS. */
  verifiedMedian: number | null;
}

const cents = (value: number) => Math.round(value * 100) / 100;

function iso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * The pipeline writes its own provenance into `conditions` ("Knox deterministic extraction from
 * Rosetta artifact #11638. canonical_hint=...; text_hash=..."): that is not a condition of the fee.
 */
const PIPELINE_NOTE = /\b(?:Knox|Rosetta artifact|canonical_hint|text_hash|calibrated_confidence|excerpt=)/i;

function notesFor(rows: SnapshotFeeRow[]): string[] {
  const notes = new Set<string>();
  for (const row of rows) {
    if (row.account_product_type) notes.add(`Account: ${row.account_product_type}`);
    if (row.conditions && !PIPELINE_NOTE.test(row.conditions)) notes.add(`Conditions: ${row.conditions}`);
    if (row.waiver_text) notes.add(`Waived: ${row.waiver_text}`);
  }
  return [...notes];
}

/**
 * One institution's value for one fee (the catalog's own rule: overdraft at its highest tier,
 * otherwise the median of its amounts), verified only when every row at that value traces to
 * its source text. When the value is a midpoint of two amounts, every row is checked.
 */
export function institutionValue(rows: SnapshotFeeRow[]): SnapshotValue | null {
  if (rows.length === 0) return null;
  const id = Number(rows[0].institution_id);
  const value = valuePerInstitution(
    rows.map((row) => ({ institution_id: id, amount: row.amount, fee_category: row.fee_category })),
  ).get(id);
  if (value === undefined) return null;
  const atValue = rows.filter((row) => cents(Number(row.amount)) === cents(value));
  const checked = atValue.length > 0 ? atValue : rows;
  const results = checked.map((row) =>
    checkFeeAgainstSource(row.normalized_text, row.fee_name, Number(row.amount), ".", row.canonical_fee_key),
  );
  const verified = results.every((result) => result.ok);
  const firstOk = results.find((result) => result.ok);
  const lead = checked[0];
  return {
    institutionId: id,
    value: cents(value),
    verified,
    sourceLine: verified && firstOk && firstOk.ok ? firstOk.sourceLine : null,
    documentUrl: lead.document_url,
    readAt: iso(lead.read_at),
    notes: notesFor(checked),
  };
}

/** The snapshot for one fee: the subject's value, each peer's, and the verified local median. */
export function buildSnapshotFee(category: string, subjectId: number, rows: SnapshotFeeRow[]): SnapshotFee {
  const byInstitution = new Map<number, SnapshotFeeRow[]>();
  for (const row of rows) {
    if (row.fee_category !== category) continue;
    const id = Number(row.institution_id);
    const list = byInstitution.get(id);
    if (list) list.push(row);
    else byInstitution.set(id, [row]);
  }
  const subject = institutionValue(byInstitution.get(subjectId) ?? []);
  const peers = [...byInstitution.entries()]
    .filter(([id]) => id !== subjectId)
    .map(([, list]) => institutionValue(list))
    .filter((value): value is SnapshotValue => value !== null)
    .sort((a, b) => a.value - b.value || a.institutionId - b.institutionId);
  const verified = peers.filter((peer) => peer.verified).map((peer) => peer.value);
  return {
    category,
    subject,
    peers,
    verifiedPeerCount: verified.length,
    verifiedMedian: verified.length >= SNAPSHOT_MIN_PEERS ? cents(median(verified) ?? 0) : null,
  };
}

export interface MarketSnapshot {
  subject: SnapshotInstitution;
  peers: SnapshotInstitution[];
  fees: SnapshotFee[];
}

function toInstitution(row: Record<string, unknown>): SnapshotInstitution {
  const text = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));
  return {
    id: Number(row.id),
    name: String(row.institution_name),
    city: text(row.city),
    stateCode: text(row.state_code),
    cbsaCode: text(row.cbsa_code),
    cbsaName: text(row.cbsa_name),
    charterType: text(row.charter_type),
  };
}

/** The institution and the open institutions in its CBSA that have live fees. */
export async function loadMarket(db: SqlTag, institutionId: number): Promise<{ subject: SnapshotInstitution; peers: SnapshotInstitution[] } | null> {
  const [subjectRow] = await db`
    SELECT id, institution_name, city, state_code, cbsa_code, cbsa_name, charter_type
      FROM institution_sources WHERE id = ${institutionId}
  `;
  if (!subjectRow) return null;
  const subject = toInstitution(subjectRow);
  if (!subject.cbsaCode) return { subject, peers: [] };
  const peerRows = await db`
    SELECT s.id, s.institution_name, s.city, s.state_code, s.cbsa_code, s.cbsa_name, s.charter_type
      FROM institution_sources s
     WHERE s.cbsa_code = ${subject.cbsaCode} AND s.id <> ${institutionId} AND s.closed_date IS NULL
       AND EXISTS (SELECT 1 FROM published_fee_catalog ef WHERE ef.institution_id = s.id)
     ORDER BY s.institution_name
  `;
  return { subject, peers: peerRows.map(toInstitution) };
}

/** Statistics-grade catalog rows for the snapshot's fees, with each row's newest source text. */
export async function loadSnapshotRows(db: SqlTag, institutionIds: number[], categories: readonly string[]): Promise<SnapshotFeeRow[]> {
  if (institutionIds.length === 0) return [];
  const rows = await db.unsafe(
    `SELECT ef.institution_id, ef.fee_category, ef.fee_name, ef.amount, ef.canonical_fee_key,
            ef.conditions, ef.account_product_type, ef.waiver_text,
            COALESCE(sd.document_url, ef.document_url, ef.source_url) AS document_url,
            COALESCE(sd.last_checked_at, sd.crawled_at) AS read_at,
            t.normalized_text
       FROM published_fee_catalog ef
       LEFT JOIN source_documents sd ON sd.id = ef.source_document_id
       LEFT JOIN LATERAL (
         SELECT ast.normalized_text FROM agent_source_texts ast
          WHERE ast.source_document_id = ef.source_document_id
            AND ast.status = 'completed' AND ast.normalized_text IS NOT NULL
          ORDER BY ast.id DESC LIMIT 1
       ) t ON true
      WHERE ${STATS_ROW_FILTER}
        AND ef.fee_category = ANY($1::text[])
        AND ef.institution_id = ANY($2::bigint[])
        AND ef.amount IS NOT NULL AND ef.amount >= 0`,
    [[...categories], institutionIds],
  );
  return rows as unknown as SnapshotFeeRow[];
}

/** The whole snapshot for one institution, or null when it isn't in the catalog. */
export async function loadMarketSnapshot(
  institutionId: number,
  options: { db?: SqlTag; categories?: readonly string[] } = {},
): Promise<MarketSnapshot | null> {
  const db = options.db ?? sql;
  const categories = options.categories ?? SNAPSHOT_FEE_KEYS;
  const market = await loadMarket(db, institutionId);
  if (!market) return null;
  const ids = [institutionId, ...market.peers.map((peer) => peer.id)];
  const rows = await loadSnapshotRows(db, ids, categories);
  return { ...market, fees: categories.map((category) => buildSnapshotFee(category, institutionId, rows)) };
}

/**
 * A short market name for a subject line: "Waco, TX" from "Waco, TX"; a metro that spans
 * several cities keeps its first two ("New York-Newark" from "New York-Newark-Jersey City,
 * NY-NJ-PA"), so a New Jersey bank isn't told its market is New York, NY.
 */
export function marketLabel(institution: Pick<SnapshotInstitution, "cbsaName" | "city" | "stateCode">): string {
  if (institution.cbsaName) {
    const [cities, states] = institution.cbsaName.split(",").map((part) => part.trim());
    const names = cities.split("-").map((name) => name.trim()).filter(Boolean);
    if (names.length > 1) return names.slice(0, 2).join("-");
    const state = states ? states.split("-")[0].trim() : null;
    return state ? `${names[0]}, ${state}` : names[0];
  }
  if (institution.city) return institution.stateCode ? `${institution.city}, ${institution.stateCode}` : institution.city;
  return "your market";
}

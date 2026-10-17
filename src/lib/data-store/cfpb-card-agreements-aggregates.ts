import { sql } from "@/lib/data-store/connection";
import type { PeerSetFilterInput } from "@/lib/data-store/saved-peers";

/**
 * Read model over cfpb_card_agreements / cfpb_agreement_terms (Magellan registry source
 * "cfpb-card-agreements"). Server only.
 *
 * Unit of count is the issuer, not the agreement: an issuer's amount for a fee is the median of
 * its products' stated amounts, so an issuer with forty card products counts once. "Charging"
 * means at least one product states an amount above zero. Ambiguous terms (amount null) are left
 * out. "Up to $40" counts as $40, the stated maximum. Dollar amounts and percentages are
 * summarized separately and never pooled. Every median carries the number of issuers behind it.
 *
 * Groups come from the matched institution (institution_sources): asset-size tier, charter,
 * state, Fed district and CBSA. Issuers that matched no institution are grouped as "unmatched";
 * a peer filter keeps only matched issuers, since an unmatched issuer has no peer dimensions.
 */

export type AgreementAggregateKind = "credit_card" | "prepaid" | "tccp_plan";
export type AgreementGroupBy = "national" | "asset_tier" | "charter" | "state" | "fed_district" | "cbsa";

export interface IssuerTermRow {
  issuerKey: string;
  group: string | null;
  termType: string;
  amountUsd: number | null;
  amountPercent: number | null;
}

export interface AgreementFeeAggregate {
  group: string;
  term_type: string;
  /** Issuers with a stated (unambiguous) amount for this fee. */
  issuers_known: number;
  issuers_charging: number;
  share_charging: number | null;
  /** Median of charging issuers' dollar amounts, and how many issuers it covers. */
  median_usd: number | null;
  median_usd_issuers: number;
  median_percent: number | null;
  median_percent_issuers: number;
}

export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Issuer-level summary per group and fee (pure, so it is unit tested). */
export function summarizeIssuerTerms(rows: IssuerTermRow[]): AgreementFeeAggregate[] {
  const byIssuer = new Map<string, { group: string; termType: string; usd: number[]; pct: number[] }>();
  for (const row of rows) {
    const group = row.group ?? "unmatched";
    const key = `${group}\u0000${row.termType}\u0000${row.issuerKey}`;
    const entry = byIssuer.get(key) ?? { group, termType: row.termType, usd: [], pct: [] };
    if (row.amountUsd !== null && Number.isFinite(row.amountUsd)) entry.usd.push(row.amountUsd);
    if (row.amountPercent !== null && Number.isFinite(row.amountPercent)) entry.pct.push(row.amountPercent);
    byIssuer.set(key, entry);
  }
  const byGroup = new Map<string, { group: string; termType: string; known: number; charging: number; usd: number[]; pct: number[] }>();
  for (const issuer of byIssuer.values()) {
    if (issuer.usd.length === 0 && issuer.pct.length === 0) continue;
    const key = `${issuer.group}\u0000${issuer.termType}`;
    const g = byGroup.get(key) ?? { group: issuer.group, termType: issuer.termType, known: 0, charging: 0, usd: [], pct: [] };
    g.known += 1;
    const usd = medianOf(issuer.usd.filter((v) => v > 0));
    const pct = medianOf(issuer.pct.filter((v) => v > 0));
    if (usd !== null || pct !== null) g.charging += 1;
    if (usd !== null) g.usd.push(usd);
    if (pct !== null) g.pct.push(pct);
    byGroup.set(key, g);
  }
  return [...byGroup.values()]
    .map((g) => ({
      group: g.group,
      term_type: g.termType,
      issuers_known: g.known,
      issuers_charging: g.charging,
      share_charging: g.known > 0 ? g.charging / g.known : null,
      median_usd: medianOf(g.usd),
      median_usd_issuers: g.usd.length,
      median_percent: medianOf(g.pct),
      median_percent_issuers: g.pct.length,
    }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.term_type.localeCompare(b.term_type));
}

const GROUP_COLUMN: Record<AgreementGroupBy, string> = {
  national: "'national'",
  asset_tier: "i.asset_size_tier",
  charter: "i.charter_type",
  state: "i.state_code",
  fed_district: "i.fed_district::text",
  cbsa: "i.cbsa_code",
};

export interface AgreementAggregateQuery {
  kind: AgreementAggregateKind;
  groupBy: AgreementGroupBy;
  /** "2026Q2" (card, prepaid) or "2026H1" (TCCP); the latest loaded period when omitted. */
  period?: string;
  /** Saved peer-set filters (src/lib/data-store/saved-peers.ts). */
  peer?: PeerSetFilterInput;
}

export interface AgreementAggregateResult {
  kind: AgreementAggregateKind;
  period: string | null;
  groupBy: AgreementGroupBy;
  rows: AgreementFeeAggregate[];
}

export async function getCfpbAgreementFeeAggregates(query: AgreementAggregateQuery): Promise<AgreementAggregateResult> {
  const groupColumn = Object.hasOwn(GROUP_COLUMN, query.groupBy) ? GROUP_COLUMN[query.groupBy] : null;
  if (!groupColumn) throw new Error(`Unknown grouping: ${String(query.groupBy)}`);
  const groupExpr = query.groupBy === "national" ? groupColumn : `CASE WHEN a.institution_id IS NULL THEN NULL ELSE ${groupColumn} END`;
  const params: unknown[] = [query.kind];
  const conditions = ["a.agreement_kind = $1", "t.ambiguous = false"];
  if (query.period) {
    params.push(query.period);
    conditions.push(`a.period = $${params.length}`);
  } else {
    conditions.push("a.period_date = (SELECT MAX(period_date) FROM cfpb_card_agreements WHERE agreement_kind = $1)");
  }
  const peer = query.peer;
  if (peer) {
    conditions.push("a.institution_id IS NOT NULL");
    if (peer.charter_type) {
      params.push(peer.charter_type);
      conditions.push(`i.charter_type = $${params.length}`);
    }
    if (peer.asset_tiers?.length) {
      params.push(peer.asset_tiers);
      conditions.push(`i.asset_size_tier = ANY($${params.length}::text[])`);
    }
    if (peer.fed_districts?.length) {
      params.push(peer.fed_districts);
      conditions.push(`i.fed_district = ANY($${params.length}::int[])`);
    }
    if (peer.states?.length) {
      params.push(peer.states);
      conditions.push(`i.state_code = ANY($${params.length}::text[])`);
    }
    if (peer.institution_ids?.length) {
      params.push(peer.institution_ids);
      conditions.push(`a.institution_id = ANY($${params.length}::bigint[])`);
    }
  }
  const rows = (await sql.unsafe(
    `SELECT COALESCE('inst:' || a.institution_id::text, 'issuer:' || lower(a.issuer_name)) AS issuer_key,
            ${groupExpr} AS grp,
            t.term_type, t.amount_usd, t.amount_percent, a.period
       FROM cfpb_card_agreements a
       JOIN cfpb_agreement_terms t ON t.agreement_id = a.id
       LEFT JOIN institution_sources i ON i.id = a.institution_id
      WHERE ${conditions.join(" AND ")} AND a.issuer_name IS NOT NULL`,
    params as never[],
  )) as unknown as Array<{ issuer_key: string; grp: string | null; term_type: string; amount_usd: string | number | null; amount_percent: string | number | null; period: string }>;
  const num = (v: string | number | null) => (v === null || v === undefined ? null : Number(v));
  return {
    kind: query.kind,
    period: query.period ?? rows[0]?.period ?? null,
    groupBy: query.groupBy,
    rows: summarizeIssuerTerms(
      rows.map((r) => ({
        issuerKey: r.issuer_key,
        // A matched institution missing the grouping field is "unknown", never folded into "unmatched".
        group: r.grp ?? (r.issuer_key.startsWith("inst:") ? "unknown" : null),
        termType: r.term_type,
        amountUsd: num(r.amount_usd),
        amountPercent: num(r.amount_percent),
      })),
    ),
  };
}

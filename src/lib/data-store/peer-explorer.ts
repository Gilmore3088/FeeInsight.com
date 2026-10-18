/**
 * The public peer explorer's read (institution page, #peers): one peer set's institutions with
 * their names, total assets and headquarters, and each one's value for the explorer's fees under
 * the statistics contract, read through getPeerFeeValues like every other peer figure. The set's
 * members come from peer-sets.ts, so a group is never computed two ways.
 */
import { sql } from "./connection";
import { getPeerFeeValues, peerInstitutionIds, type PeerFeeValue, type PeerFilterSet } from "./fee-index";
import { computeStats } from "./fees";
import { getPeerSubject, resolvePeerInstitutionIds } from "./peer-sets";
import { MIN_PEERS_FOR_PEER_SET_MEDIAN } from "./peer-fee-rank";
import { institutionDisplayName } from "@/lib/institution-display-name";
import { displayCity } from "@/lib/format";
import {
  EXPLORER_FEE_KEYS,
  type ExplorerFee,
  type ExplorerFeeKey,
  type ExplorerInstitution,
  type ExplorerMedian,
  type PeerExplorerSet,
} from "@/lib/peer-explorer";

/** Never named on a public page (as on the district hub and the samples). */
export const HIDDEN_INSTITUTION = /frost bank/i;

/** A long waiver note is cut here; the full schedule is one click away on the institution's page. */
const CONDITIONS_MAX_CHARS = 220;
/** At most this many prices are listed for one value. */
const PRICES_MAX = 8;

function clip(text: string | null | undefined): string | null {
  const clean = text?.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > CONDITIONS_MAX_CHARS ? `${clean.slice(0, CONDITIONS_MAX_CHARS - 1).trimEnd()}…` : clean;
}

/** One institution's value for one fee, with every price behind it when there is more than one. */
export function explorerFee(value: PeerFeeValue): ExplorerFee {
  const records = value.fee_records ?? [];
  if (records.length < 2) return { amount: value.amount };
  return {
    amount: value.amount,
    prices: [...records]
      .sort((a, b) => a.amount - b.amount || a.id - b.id)
      .slice(0, PRICES_MAX)
      .map((record) => ({ amount: record.amount, name: record.fee_name?.trim() || null, conditions: clip(record.conditions) })),
  };
}

interface FactRow {
  id: number | string;
  institution_name: string | null;
  asset_size: number | string | null;
  city: string | null;
  state_code: string | null;
  charter_type: string | null;
}

/**
 * Builds the explorer's set from the institutions' facts and their fee values. The subject is
 * kept apart; a hidden institution is left out of the peers, so every count, median and dot on
 * the page is drawn from the same institutions a visitor can see.
 */
export function buildPeerExplorerSet(
  subjectId: number,
  facts: FactRow[],
  byCategory: Map<string, PeerFeeValue[]>,
): PeerExplorerSet | null {
  const fees = new Map<number, Partial<Record<ExplorerFeeKey, ExplorerFee>>>();
  for (const key of EXPLORER_FEE_KEYS) {
    for (const value of byCategory.get(key) ?? []) {
      const own = fees.get(value.institution_id) ?? {};
      own[key] = explorerFee(value);
      fees.set(value.institution_id, own);
    }
  }
  const toInstitution = (row: FactRow): ExplorerInstitution => {
    const id = Number(row.id);
    const thousands = row.asset_size === null || row.asset_size === "" ? NaN : Number(row.asset_size);
    return {
      id,
      name: institutionDisplayName(row.institution_name ?? "") || `Institution ${id}`,
      assets: Number.isFinite(thousands) && thousands > 0 ? thousands * 1000 : null,
      city: row.city ? displayCity(row.city) : null,
      state: row.state_code ?? null,
      fees: fees.get(id) ?? {},
    };
  };
  const subjectRow = facts.find((row) => Number(row.id) === subjectId);
  if (!subjectRow || HIDDEN_INSTITUTION.test(subjectRow.institution_name ?? "")) return null;
  const peers = facts
    .filter((row) => Number(row.id) !== subjectId && !HIDDEN_INSTITUTION.test(row.institution_name ?? ""))
    .map(toInstitution);
  const medians: Partial<Record<ExplorerFeeKey, ExplorerMedian>> = {};
  for (const key of EXPLORER_FEE_KEYS) {
    const values = peers.map((peer) => peer.fees[key]?.amount).filter((v): v is number => v !== undefined);
    if (values.length >= MIN_PEERS_FOR_PEER_SET_MEDIAN) {
      const { median } = computeStats(values);
      if (median !== null) medians[key] = { median, peers: values.length };
    }
  }
  return { subject: toInstitution(subjectRow), peers, charterType: subjectRow.charter_type ?? null, medians };
}

/**
 * One peer set for the explorer. `filters` is the set as public-peer-sets.ts resolved it: chosen
 * institutions (nearest, metro, regulator) or a plain filter (state, Fed district, size), whose
 * members peer-sets.ts finds. Members are the institutions that publish at least one approved fee,
 * the same rule the nearest set uses, so every listed peer has a schedule to compare.
 */
export async function getPeerExplorerSet(institutionId: number, filters: PeerFilterSet): Promise<PeerExplorerSet | null> {
  const subject = await getPeerSubject(institutionId);
  if (!subject) return null;
  const chosen = peerInstitutionIds(filters);
  const memberIds = chosen ? chosen.filter((id) => id !== institutionId) : await resolvePeerInstitutionIds(filters, subject);
  const ids = [institutionId, ...memberIds];
  const facts = (await sql`
    SELECT s.id, s.institution_name, s.asset_size, s.city, s.state_code, s.charter_type
      FROM institution_sources s
     WHERE s.id = ANY(${ids}::bigint[])
       AND (s.id = ${institutionId}
            OR EXISTS (SELECT 1 FROM published_fee_catalog p WHERE p.institution_id = s.id AND p.review_status = 'approved'))
  `) as FactRow[];
  const [byCategory] = await getPeerFeeValues(
    [{ institutionIds: facts.map((row) => Number(row.id)) }],
    [...EXPLORER_FEE_KEYS],
    undefined,
    { onlyInstitutionIds: facts.map((row) => Number(row.id)), withConditions: true },
  );
  return buildPeerExplorerSet(institutionId, facts, byCategory ?? new Map());
}

import { normalizeLei } from "./gleif";
import { normalizeKey } from "./gleif-lei-match";

/** Exact identifiers only. Parent IDs, names and name/state LEI proposals are never lender identity. */
export interface HmdaInstitutionIdentity {
  id: number;
  lei: string | null;
  rssdId: string | null;
  source?: string | null;
  certNumber?: string | null;
  registrySyncedAt?: string | null;
  leiLink?: {
    status: string;
    lei: string | null;
    basis: string | null;
    candidates?: string[];
    sourceUrl?: string | null;
    checkedAt?: string | null;
    matchKey?: string | null;
  } | null;
}

export interface HmdaLenderIdentity {
  lei: string;
  rssdId: string | null;
  sourceConflict?: boolean;
}

/** Frozen decision inputs, including the distinction between a publisher ID and a crosswalk. */
export interface HmdaIdentityEvidence {
  institutionId: number;
  kind: "institution_lei" | "canonical_lei_link" | "respondent_rssd";
  lei: string | null;
  rssdId: string | null;
  source: string | null;
  certNumber: string | null;
  registrySyncedAt: string | null;
  linkBasis: string | null;
  linkKey: string | null;
  sourceUrl: string | null;
  checkedAt: string | null;
}

/** Complete canonical facts for each candidate, including facts that blocked acceptance. */
export interface HmdaCanonicalSnapshot {
  id: number;
  lei: string | null;
  rssdId: string | null;
  source: string | null;
  certNumber: string | null;
  registrySyncedAt: string | null;
  leiLink: {
    status: string;
    lei: string | null;
    basis: string | null;
    candidates: string[];
    sourceUrl: string | null;
    checkedAt: string | null;
    matchKey: string | null;
  } | null;
}

export interface HmdaIdentityMatch {
  lei: string;
  institutionId: number | null;
  method: "lei" | "rssd" | null;
  status: "matched" | "unmatched" | "ambiguous";
  reason: string;
  candidateIds: number[];
  evidence: HmdaIdentityEvidence[];
  canonicalSnapshots: HmdaCanonicalSnapshot[];
}

const KEY_BASES = new Set(["own_lei", "rssd", "fdic_cert", "ncua_charter"]);
type Candidates = Map<string, Set<number>>;

/** HMDA uses -1/0 for absent identifiers. Numeric padding is not part of RSSD identity. */
export function normalizeHmdaRssd(value: unknown): string | null {
  const key = normalizeKey(value);
  return key && key !== "0" ? key : null;
}

function add(index: Candidates, key: string | null, id: number): void {
  if (!key) return;
  const ids = index.get(key) ?? new Set<number>();
  ids.add(id);
  index.set(key, ids);
}

export function matchHmdaIdentities(
  lenders: readonly HmdaLenderIdentity[],
  institutions: readonly HmdaInstitutionIdentity[],
): HmdaIdentityMatch[] {
  const byLei: Candidates = new Map();
  const byRssd: Candidates = new Map();
  const blockedLeis = new Set<string>();
  const leiEvidence = new Map<string, HmdaIdentityEvidence[]>();
  const rssdEvidence = new Map<string, HmdaIdentityEvidence[]>();
  const snapshots = new Map<number, HmdaCanonicalSnapshot>();
  const capture = (index: Map<string, HmdaIdentityEvidence[]>, key: string | null, value: HmdaIdentityEvidence) => {
    if (key) index.set(key, [...(index.get(key) ?? []), value]);
  };
  for (const institution of institutions) {
    if (!Number.isSafeInteger(institution.id) || institution.id < 1) throw new Error("Invalid canonical institution ID");
    const own = normalizeLei(institution.lei);
    const link = institution.leiLink;
    snapshots.set(institution.id, {
      id: institution.id,
      lei: institution.lei,
      rssdId: institution.rssdId,
      source: institution.source ?? null,
      certNumber: institution.certNumber ?? null,
      registrySyncedAt: institution.registrySyncedAt ?? null,
      leiLink: link ? {
        status: link.status,
        lei: link.lei,
        basis: link.basis,
        candidates: [...(link.candidates ?? [])],
        sourceUrl: link.sourceUrl ?? null,
        checkedAt: link.checkedAt ?? null,
        matchKey: link.matchKey ?? null,
      } : null,
    });
    const accepted = link?.status === "linked" && link.basis && KEY_BASES.has(link.basis) ? normalizeLei(link.lei) : null;
    const rssd = normalizeHmdaRssd(institution.rssdId);
    const provenance = {
      institutionId: institution.id,
      source: institution.source ?? null,
      certNumber: institution.certNumber ?? null,
      registrySyncedAt: institution.registrySyncedAt ?? null,
      linkBasis: null, linkKey: null, sourceUrl: null, checkedAt: null,
    };
    add(byLei, own, institution.id);
    add(byLei, accepted, institution.id);
    add(byRssd, rssd, institution.id);
    capture(leiEvidence, own, { ...provenance, kind: "institution_lei", lei: own, rssdId: rssd });
    capture(rssdEvidence, rssd, { ...provenance, kind: "respondent_rssd", lei: own, rssdId: rssd });
    capture(leiEvidence, accepted, {
      ...provenance, kind: "canonical_lei_link", lei: accepted, rssdId: rssd,
      linkBasis: link?.basis ?? null, linkKey: link?.matchKey ?? null,
      sourceUrl: link?.sourceUrl ?? null, checkedAt: link?.checkedAt ?? null,
    });
    if (own && accepted && own !== accepted) {
      blockedLeis.add(own);
      blockedLeis.add(accepted);
    }
    if (link?.status === "ambiguous") {
      for (const raw of [own, link.lei, ...(link.candidates ?? [])]) {
        const lei = normalizeLei(raw);
        if (lei) {
          blockedLeis.add(lei);
          add(byLei, lei, institution.id);
        }
      }
    }
  }

  return lenders.map((lender) => {
    const lei = normalizeLei(lender.lei);
    const rssd = normalizeHmdaRssd(lender.rssdId);
    const leiIds = lei ? byLei.get(lei) ?? new Set<number>() : new Set<number>();
    const rssdIds = rssd ? byRssd.get(rssd) ?? new Set<number>() : new Set<number>();
    const candidateIds = [...new Set([...leiIds, ...rssdIds])].sort((a, b) => a - b);
    const evidence = [...(lei ? leiEvidence.get(lei) ?? [] : []), ...(rssd ? rssdEvidence.get(rssd) ?? [] : [])];
    const canonicalSnapshots = candidateIds.map((id) => snapshots.get(id)!);
    const base = { lei: lender.lei, institutionId: null, method: null, candidateIds, evidence, canonicalSnapshots };
    if (!lei) return { ...base, status: "unmatched", reason: "invalid_lei" };
    if (lender.sourceConflict) return { ...base, status: "ambiguous", reason: "panel_identity_conflict" };
    if (blockedLeis.has(lei)) return { ...base, status: "ambiguous", reason: "canonical_lei_conflict" };
    if (candidateIds.length > 1) {
      return { ...base, status: "ambiguous", reason: leiIds.size > 1 ? "shared_lei" : rssdIds.size > 1 ? "shared_rssd" : "identifier_disagreement" };
    }
    if (candidateIds.length === 0) return { ...base, status: "unmatched", reason: "no_authoritative_identity" };
    return {
      ...base,
      institutionId: candidateIds[0],
      method: leiIds.size === 1 ? "lei" : "rssd",
      status: "matched",
      reason: leiIds.size === 1 ? "exact_lei" : "exact_respondent_rssd",
    };
  });
}

export interface HmdaMatchingSummary {
  matched: number;
  unmatched: number;
  ambiguous: number;
  reasons: Record<string, number>;
}

export function summarizeHmdaMatching(matches: readonly HmdaIdentityMatch[]): HmdaMatchingSummary {
  const out: HmdaMatchingSummary = { matched: 0, unmatched: 0, ambiguous: 0, reasons: {} };
  for (const match of matches) {
    out[match.status] += 1;
    out.reasons[match.reason] = (out.reasons[match.reason] ?? 0) + 1;
  }
  return out;
}

export const HMDA_REPAIR_MAX_LENDERS = 25;
export const HMDA_REPAIR_MAX_CELLS = 1_000;

export interface HmdaRepairLender {
  year: number;
  lei: string;
  institutionId: number | null;
  matchMethod: string | null;
  rssdId: string | null;
}

export interface HmdaRepairCellCount {
  year: number;
  lei: string;
  originationRows: number;
  costRows: number;
  states: string[];
}

/**
 * Read-only review plan over a captured snapshot. It is not a queue/apply operation. Counts
 * cover ALL states for each annual lender: its denormalized child IDs must move together.
 */
export function planHmdaIdentityRepair(input: {
  year: number;
  leis: string[];
  lenders: HmdaRepairLender[];
  institutions: HmdaInstitutionIdentity[];
  cells: HmdaRepairCellCount[];
}) {
  if (!Number.isInteger(input.year) || input.year < 2018 || input.year > 2100) throw new Error("Invalid HMDA repair year");
  const leis = [...new Set(input.leis.map((value) => normalizeLei(value)))];
  if (leis.includes(null) || leis.length !== input.leis.length || leis.length < 1 || leis.length > HMDA_REPAIR_MAX_LENDERS) {
    throw new Error(`HMDA repair requires 1-${HMDA_REPAIR_MAX_LENDERS} distinct valid explicit LEIs`);
  }
  const selected = leis.map((lei) => {
    const lenders = input.lenders.filter((row) => row.year === input.year && row.lei === lei);
    const cells = input.cells.filter((row) => row.year === input.year && row.lei === lei);
    if (lenders.length !== 1 || cells.length !== 1) throw new Error(`Missing or duplicate annual lender/cell census: ${lei}`);
    if (lenders[0].institutionId !== null || lenders[0].matchMethod !== null) throw new Error(`HMDA initial-link repair requires an unlinked annual lender: ${lei}`);
    const cell = cells[0];
    if (![cell.originationRows, cell.costRows].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error("Invalid HMDA cell count");
    return { lender: lenders[0], cell };
  });
  const aggregateRows = selected.reduce((sum, { cell }) => sum + cell.originationRows + cell.costRows, 0);
  if (aggregateRows > HMDA_REPAIR_MAX_CELLS) throw new Error(`HMDA repair exceeds ${HMDA_REPAIR_MAX_CELLS} aggregate rows across all states`);
  const matches = matchHmdaIdentities(selected.map(({ lender }) => lender), input.institutions);
  const rows = selected.map(({ lender, cell }, index) => ({
    ...matches[index],
    beforeInstitutionId: lender.institutionId,
    beforeMatchMethod: lender.matchMethod,
    originationRows: cell.originationRows,
    costRows: cell.costRows,
    states: [...cell.states].sort(),
    changes: matches[index].status === "matched" && (lender.institutionId !== matches[index].institutionId || lender.matchMethod !== matches[index].method),
  }));
  return {
    mode: "review_only" as const,
    year: input.year,
    lenderCap: HMDA_REPAIR_MAX_LENDERS,
    aggregateRowCap: HMDA_REPAIR_MAX_CELLS,
    lenderRows: rows.length,
    aggregateRows,
    summary: summarizeHmdaMatching(matches),
    proposedLenderChanges: rows.filter((row) => row.changes).length,
    rows,
    writes: 0 as const,
  };
}

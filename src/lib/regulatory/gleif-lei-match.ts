import { GLEIF_API_BASE, normalizeLei, type GleifEntity, type RegistrationAuthority } from "./gleif";

/**
 * Matching tracked institutions to GLEIF LEIs (#1868). Pure: no DB access, no fetches.
 *
 * Keys, strongest first: the institution's own LEI; a GLEIF record registered with the Fed's
 * National Information Center under its RSSD id, with the FDIC under its cert, or with the NCUA
 * under its charter; else one GLEIF record whose legal name equals the institution's name and
 * whose legal address is in its state. A name alone never links. Two candidates are never
 * resolved by picking one: the institution goes to the review queue as ambiguous.
 */

export type LeiMatchBasis = "own_lei" | "rssd" | "fdic_cert" | "ncua_charter" | "name_state";
export type KeyBasis = "rssd" | "fdic_cert" | "ncua_charter";
export type LeiLinkStatus = "linked" | "ambiguous" | "unmatched";

export const BASIS_RANK: Record<LeiMatchBasis, number> = { own_lei: 0, rssd: 1, fdic_cert: 2, ncua_charter: 3, name_state: 4 };
const KEYS_DISAGREE = "Keys disagree";
export const KEY_BASES: readonly KeyBasis[] = ["rssd", "fdic_cert", "ncua_charter"];

/** Registration authorities found by name in GLEIF's own list, per key. */
const AUTHORITY_NAME: Record<KeyBasis, RegExp> = {
  rssd: /national information center/i,
  fdic_cert: /federal deposit insurance corporation/i,
  ncua_charter: /national credit union administration/i,
};

export function keyAuthorities(authorities: RegistrationAuthority[], basis: KeyBasis): RegistrationAuthority[] {
  return authorities.filter((a) => AUTHORITY_NAME[basis].test(a.name));
}

export function authorityLeiRecordsUrl(authorityId: string, page: number, pageSize = 200): string {
  return `${GLEIF_API_BASE}/lei-records?filter%5Bentity.registeredAt.id%5D=${encodeURIComponent(authorityId)}&page%5Bsize%5D=${pageSize}&page%5Bnumber%5D=${page}`;
}

export function nameStateSearchUrl(name: string, state: string): string {
  return `${GLEIF_API_BASE}/lei-records?filter%5Bentity.legalName%5D=${encodeURIComponent(name)}&filter%5Bentity.legalAddress.region%5D=US-${encodeURIComponent(state)}&page%5Bsize%5D=20`;
}

export function lastPageOf(json: unknown): number | null {
  const meta = (json as { meta?: { pagination?: { lastPage?: unknown } } } | null)?.meta?.pagination?.lastPage;
  const n = Number(meta);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Digits only, leading zeros dropped: "0012345" and "12345" are one key. */
export function normalizeKey(value: unknown): string | null {
  const v = value === null || value === undefined ? "" : String(value).trim();
  return /^\d{1,12}$/.test(v) ? String(Number(v)) : null;
}

/** Case, spacing and punctuation aside; "&" reads as "and". Nothing else is rewritten. */
export function normalizeLegalName(value: string | null | undefined): string | null {
  if (!value) return null;
  const out = value
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return out === "" ? null : out;
}

/** A record that may be linked: not retired, annulled, merged or a duplicate, and not an inactive entity. */
export function usableEntity(e: Pick<GleifEntity, "registrationStatus" | "entityStatus">): boolean {
  const reg = (e.registrationStatus ?? "").toUpperCase();
  if (["ANNULLED", "RETIRED", "DUPLICATE", "MERGED"].includes(reg)) return false;
  return (e.entityStatus ?? "").toUpperCase() !== "INACTIVE";
}

export interface LeiUniverseInstitution {
  id: number;
  source: string;
  lei: string | null;
  rssd: string | null;
  cert: string | null;
  charter: string | null;
  name: string | null;
  state: string | null;
}

/** What one basis says about one institution. `none` means the basis was checked and found nothing. */
export type LeiProposal =
  | { kind: "linked"; basis: LeiMatchBasis; lei: string; key: string | null }
  | { kind: "ambiguous"; basis: LeiMatchBasis; candidates: string[]; key: string | null; reason: string }
  | { kind: "none"; basis: LeiMatchBasis; key: string | null; reason: string };

function institutionKey(inst: LeiUniverseInstitution, basis: KeyBasis): string | null {
  if (basis === "rssd") return normalizeKey(inst.rssd);
  if (basis === "fdic_cert") return inst.source === "fdic" ? normalizeKey(inst.cert) : null;
  return inst.source === "ncua" ? normalizeKey(inst.charter) : null;
}

/**
 * One proposal per institution that carries the key, from the records registered with that key's
 * authorities. Records whose authority is not one of `authorityIds` are ignored.
 */
export function proposeByKey(universe: LeiUniverseInstitution[], entities: GleifEntity[], basis: KeyBasis, authorityIds: Set<string>): Map<number, LeiProposal> {
  const leisByKey = new Map<string, Set<string>>();
  for (const e of entities) {
    if (!e.registeredAtId || !authorityIds.has(e.registeredAtId) || !usableEntity(e)) continue;
    const key = normalizeKey(e.registeredAs);
    if (!key) continue;
    if (!leisByKey.has(key)) leisByKey.set(key, new Set());
    leisByKey.get(key)!.add(e.lei);
  }
  const instByKey = new Map<string, number[]>();
  for (const inst of universe) {
    const key = institutionKey(inst, basis);
    if (!key) continue;
    if (!instByKey.has(key)) instByKey.set(key, []);
    instByKey.get(key)!.push(inst.id);
  }
  const out = new Map<number, LeiProposal>();
  for (const [key, ids] of instByKey) {
    const leis = [...(leisByKey.get(key) ?? [])].sort();
    for (const id of ids) {
      if (leis.length === 0) out.set(id, { kind: "none", basis, key, reason: `No GLEIF record is registered under this ${basis}` });
      else if (ids.length > 1) out.set(id, { kind: "ambiguous", basis, key, candidates: leis, reason: `${ids.length} tracked institutions share this ${basis}` });
      else if (leis.length > 1) out.set(id, { kind: "ambiguous", basis, key, candidates: leis, reason: `${leis.length} GLEIF records are registered under this ${basis}` });
      else out.set(id, { kind: "linked", basis, key, lei: leis[0] });
    }
  }
  return out;
}

/** Institutions that carry their own LEI. */
export function proposeOwnLei(universe: LeiUniverseInstitution[]): Map<number, LeiProposal> {
  const out = new Map<number, LeiProposal>();
  for (const inst of universe) {
    const lei = normalizeLei(inst.lei);
    if (lei) out.set(inst.id, { kind: "linked", basis: "own_lei", key: lei, lei });
  }
  return out;
}

/** The exact name-and-state rule over one search's records. */
export function proposeByNameState(inst: LeiUniverseInstitution, entities: GleifEntity[]): LeiProposal {
  const name = normalizeLegalName(inst.name);
  const state = inst.state?.trim().toUpperCase() ?? null;
  const key = name && state ? `${name}|${state}` : null;
  if (!name || !state) return { kind: "none", basis: "name_state", key, reason: "The institution has no name or state on record" };
  const leis = [...new Set(entities.filter((e) => usableEntity(e) && e.legalState === state && normalizeLegalName(e.legalName) === name).map((e) => e.lei))].sort();
  if (leis.length === 0) return { kind: "none", basis: "name_state", key, reason: "No GLEIF record has this exact legal name in this state" };
  if (leis.length > 1) return { kind: "ambiguous", basis: "name_state", key, candidates: leis, reason: `${leis.length} GLEIF records have this exact legal name in this state` };
  return { kind: "linked", basis: "name_state", key, lei: leis[0] };
}

export interface LeiLinkRow {
  institutionId: number;
  status: LeiLinkStatus;
  lei: string | null;
  basis: LeiMatchBasis | null;
  key: string | null;
  candidates: string[];
  reason: string | null;
}

function stronger(a: LeiMatchBasis | null, b: LeiMatchBasis): LeiMatchBasis {
  return a && BASIS_RANK[a] < BASIS_RANK[b] ? a : b;
}

function fromProposal(id: number, p: LeiProposal): LeiLinkRow {
  if (p.kind === "linked") return { institutionId: id, status: "linked", lei: p.lei, basis: p.basis, key: p.key, candidates: [], reason: null };
  if (p.kind === "ambiguous") return { institutionId: id, status: "ambiguous", lei: null, basis: p.basis, key: p.key, candidates: p.candidates, reason: p.reason };
  return { institutionId: id, status: "unmatched", lei: null, basis: null, key: p.key, candidates: [], reason: p.reason };
}

/**
 * The row an institution should hold after one basis's proposal, given the row it holds now.
 * Returns null when nothing changes. A key basis replaces a name_state or unmatched row; two
 * key bases that disagree make the row ambiguous; a basis that no longer finds its own link
 * clears it to unmatched. A name_state proposal never touches a key-based row.
 */
export function mergeLeiLink(existing: LeiLinkRow | null, proposal: LeiProposal, institutionId: number): LeiLinkRow | null {
  const next = fromProposal(institutionId, proposal);
  if (!existing) return proposal.kind === "none" && proposal.basis !== "name_state" ? null : next;
  const existingIsKey = existing.basis !== null && existing.basis !== "name_state";
  if (proposal.basis === "name_state" && existingIsKey) return null;
  if (existing.basis === proposal.basis || !existingIsKey) {
    if (proposal.kind === "none" && existing.basis !== proposal.basis && proposal.basis !== "name_state") return null;
    // Two keys that disagreed stay in review until a person settles them or a key stops finding a record.
    if (existing.status === "ambiguous" && existing.reason?.startsWith(KEYS_DISAGREE) && proposal.kind !== "none") return null;
    return sameRow(existing, next) ? null : next;
  }
  // existing is another key basis
  if (proposal.kind === "none") return null;
  const have = existing.status === "linked" && existing.lei ? [existing.lei] : existing.candidates;
  const add = proposal.kind === "linked" ? [proposal.lei] : proposal.candidates;
  const all = [...new Set([...have, ...add])].sort();
  const basis = stronger(existing.basis, proposal.basis);
  const merged: LeiLinkRow =
    all.length === 1 && existing.status === "linked" && proposal.kind === "linked"
      ? { institutionId, status: "linked", lei: all[0], basis, key: basis === existing.basis ? existing.key : proposal.key, candidates: [], reason: null }
      : { institutionId, status: "ambiguous", lei: null, basis, key: existing.key, candidates: all, reason: existing.status === "ambiguous" && all.length === existing.candidates.length ? existing.reason : `${KEYS_DISAGREE}: ${existing.basis} and ${proposal.basis} point to different GLEIF records` };
  return sameRow(existing, merged) ? null : merged;
}

function sameRow(a: LeiLinkRow, b: LeiLinkRow): boolean {
  return a.status === b.status && a.lei === b.lei && a.basis === b.basis && a.key === b.key && a.reason === b.reason && a.candidates.join(",") === b.candidates.join(",");
}

import type { FdicIdentityHold } from "@/lib/data-store/fdic-identity-holds";
import { createGleifIdentityVeto } from "./gleif-identity-holds";
import { createHash } from "node:crypto";
import { normalizeLei } from "./lei";
import { readZipLines } from "./economy";
import { registryFetch, registryFetchJson, type RegistryFetchOptions } from "./http";
import { CsvStreamParser } from "./industry-events";

/**
 * GLEIF legal entity identifiers (https://www.gleif.org), free to use under GLEIF's terms of
 * use: "The data available through the Access Service are provided under the CC0 licence"
 * (read 2026-10-17; the loader records the terms URL with every run). Pure transport
 * and parsing: no DB access.
 *
 * - Level 1 (who is who): read from GLEIF's API (`/lei-records?filter[lei]=...`, 200 per call),
 *   for the LEIs we already hold (institution_sources.lei) and the parents and siblings level 2
 *   names. The API serves the same records as the golden copy; the full level-1 golden copy is
 *   several gigabytes of CSV, too large for a serverless step, so it is not downloaded.
 * - Level 2 (who owns whom): the golden copy's relationship-record (RR) file, streamed from its
 *   zip, keeping direct and ultimate accounting-consolidation parents.
 *
 * GLEIF's sites are blocked from the sandbox this was written in: the golden-copy index shape,
 * the RR column names and the API attribute paths are from GLEIF's documentation as remembered,
 * and each is checked at run time; a missing one is reported by name, never filled.
 */

export const GLEIF_API_BASE = "https://api.gleif.org/api/v1";
export const GLEIF_GOLDEN_COPY_LATEST_URL = "https://goldencopy.gleif.org/api/v2/golden-copies/publishes/latest";
export const GLEIF_TERMS_URL = "https://www.gleif.org/en/meta/lei-data-terms-of-use";
export const GLEIF_LICENSE_NOTE = "GLEIF data, CC0 1.0 under GLEIF's terms of use (read 2026-10-17); do not imply GLEIF endorsement";

export const GLEIF_LEVEL2_PARTITION = "level2";
export const GLEIF_LEVEL1_SHARDS = 8;

/**
 * LEI matching for tracked institutions (#1868), keys before the name search. Only the
 * partition keys live here; the matching is gleif-lei-match.ts.
 */
export const GLEIF_LEI_MATCH_PARTITIONS = ["lei-match-rssd", "lei-match-fdic", "lei-match-ncua", "lei-match-name"] as const;

/**
 * LEI matching first, so level 2 has LEIs to look up; then level 2, so the level-1 shards also
 * pick up the parents and siblings it names.
 */
export function gleifPartitions(): string[] {
  return [...GLEIF_LEI_MATCH_PARTITIONS, GLEIF_LEVEL2_PARTITION, ...Array.from({ length: GLEIF_LEVEL1_SHARDS }, (_, i) => `level1-${i}`)];
}

export function level1ShardOf(partitionKey: string): number | null {
  const m = /^level1-(\d+)$/.exec(partitionKey);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 0 && n < GLEIF_LEVEL1_SHARDS ? n : null;
}

export { normalizeLei };

export function leiShard(lei: string): number {
  return createHash("sha1").update(lei).digest()[0] % GLEIF_LEVEL1_SHARDS;
}

// ---------------------------------------------------------------------------------------------
// Level 1: API records

export function leiRecordsUrl(leis: string[]): string {
  return `${GLEIF_API_BASE}/lei-records?filter%5Blei%5D=${leis.join(",")}&page%5Bsize%5D=200`;
}

export function registrationAuthoritiesUrl(page: number): string {
  return `${GLEIF_API_BASE}/registration-authorities?page%5Bsize%5D=200&page%5Bnumber%5D=${page}`;
}

/** Attribute paths the loader reads from a level-1 record. */
export const GLEIF_LEVEL1_FIELDS = [
  "lei",
  "entity.legalName.name",
  "entity.legalAddress.country",
  "entity.legalAddress.region",
  "entity.legalAddress.city",
  "entity.headquartersAddress.country",
  "entity.jurisdiction",
  "entity.status",
  "entity.category",
  "entity.legalForm.id",
  "entity.registeredAt.id",
  "entity.registeredAs",
  "registration.status",
  "registration.lastUpdateDate",
  "registration.nextRenewalDate",
] as const;

export interface GleifEntity {
  lei: string;
  legalName: string | null;
  jurisdiction: string | null;
  legalCountry: string | null;
  /** ISO 3166-2 region as filed ("US-NY"). */
  legalRegion: string | null;
  /** Postal code of the legal-address state when the region is "US-XX". */
  legalState: string | null;
  legalCity: string | null;
  hqCountry: string | null;
  category: string | null;
  legalFormId: string | null;
  entityStatus: string | null;
  registrationStatus: string | null;
  registeredAtId: string | null;
  registeredAs: string | null;
  lastUpdate: string | null;
  nextRenewal: string | null;
  raw: Record<string, unknown>;
}

function at(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function str(value: unknown): string | null {
  if (value === null || value === undefined || typeof value === "object") return null;
  const out = String(value).trim();
  return out === "" ? null : out;
}

export interface Level1Read {
  entities: GleifEntity[];
  /** Fields no record in the response carried (a path that is null on some records is not missing). */
  missingFields: string[];
  skipped: Record<string, number>;
  valid: boolean;
}

export function parseLeiRecords(json: unknown): Level1Read {
  const data = at(json, "data");
  if (!Array.isArray(data)) return { entities: [], missingFields: ["data"], skipped: {}, valid: false };
  const present = new Set<string>();
  const entities: GleifEntity[] = [];
  const skipped: Record<string, number> = {};
  for (const rec of data) {
    const a = at(rec, "attributes");
    if (!a || typeof a !== "object") {
      skipped.no_attributes = (skipped.no_attributes ?? 0) + 1;
      continue;
    }
    for (const f of GLEIF_LEVEL1_FIELDS) if (at(a, f) !== undefined) present.add(f);
    const lei = normalizeLei(at(a, "lei") ?? at(rec, "id"));
    if (!lei) {
      skipped.bad_lei = (skipped.bad_lei ?? 0) + 1;
      continue;
    }
    const region = str(at(a, "entity.legalAddress.region"));
    const m = region ? /^US-([A-Z]{2})$/.exec(region.toUpperCase()) : null;
    entities.push({
      lei,
      legalName: str(at(a, "entity.legalName.name")),
      jurisdiction: str(at(a, "entity.jurisdiction")),
      legalCountry: str(at(a, "entity.legalAddress.country")),
      legalRegion: region,
      legalState: m ? m[1] : null,
      legalCity: str(at(a, "entity.legalAddress.city")),
      hqCountry: str(at(a, "entity.headquartersAddress.country")),
      category: str(at(a, "entity.category")),
      legalFormId: str(at(a, "entity.legalForm.id")),
      entityStatus: str(at(a, "entity.status")),
      registrationStatus: str(at(a, "registration.status")),
      registeredAtId: str(at(a, "entity.registeredAt.id")),
      registeredAs: str(at(a, "entity.registeredAs")),
      lastUpdate: str(at(a, "registration.lastUpdateDate")),
      nextRenewal: str(at(a, "registration.nextRenewalDate")),
      raw: a as Record<string, unknown>,
    });
  }
  const missingFields = data.length > 0 ? GLEIF_LEVEL1_FIELDS.filter((f) => !present.has(f)) : [];
  return { entities, missingFields, skipped, valid: true };
}

export async function fetchLeiRecords(leis: string[], options: RegistryFetchOptions = {}): Promise<Level1Read & { url: string }> {
  const url = leiRecordsUrl(leis);
  return { ...parseLeiRecords(await registryFetchJson<unknown>(url, options)), url };
}

export interface RegistrationAuthority {
  id: string;
  name: string;
}

export function parseRegistrationAuthorities(json: unknown): { authorities: RegistrationAuthority[]; lastPage: number | null; valid: boolean } {
  const data = at(json, "data");
  if (!Array.isArray(data)) return { authorities: [], lastPage: null, valid: false };
  const authorities: RegistrationAuthority[] = [];
  for (const rec of data) {
    const id = str(at(rec, "attributes.code")) ?? str(at(rec, "id"));
    const names = [str(at(rec, "attributes.internationalName")), str(at(rec, "attributes.localName")), str(at(rec, "attributes.internationalOrganizationName")), str(at(rec, "attributes.localOrganizationName"))].filter(Boolean);
    if (id && names.length > 0) authorities.push({ id, name: names.join(" / ") });
  }
  const lastPage = Number(at(json, "meta.pagination.lastPage"));
  return { authorities, lastPage: Number.isInteger(lastPage) ? lastPage : null, valid: true };
}

/**
 * Registration authorities whose name says they are the Fed's National Information Center,
 * the registry whose ids are RSSD ids. Found by name in GLEIF's own list, not hardcoded.
 */
export function rssdAuthorities(authorities: RegistrationAuthority[]): RegistrationAuthority[] {
  return authorities.filter((a) => /national information center/i.test(a.name));
}

/** RSSD id from a record registered with an RSSD authority; null otherwise. */
export function rssdOf(entity: Pick<GleifEntity, "registeredAtId" | "registeredAs">, rssdAuthorityIds: Set<string>): string | null {
  if (!entity.registeredAtId || !rssdAuthorityIds.has(entity.registeredAtId)) return null;
  const v = entity.registeredAs?.trim() ?? "";
  return /^\d{1,10}$/.test(v) ? String(Number(v)) : null;
}

export interface GleifUniverseInstitution {
  id: number;
  source?: string | null;
  cert?: string | null;
  identityLeis?: string[];
  lei: string | null;
  rssd: string | null;
}

export type GleifLinkMethod = "lei" | "rssd";

/** Link by the institution's own LEI, else by an RSSD in the GLEIF record; one institution only. */
export function createGleifLinker(universe: GleifUniverseInstitution[], holds: readonly FdicIdentityHold[] = []) {
  const veto = createGleifIdentityVeto(holds);
  const heldIds = new Set(universe.filter((u) => veto.blocksInstitution(u.id, u.cert, u.source) || veto.blocksLei(u.lei) || u.identityLeis?.some((lei) => veto.blocksLei(lei))).map((u) => u.id));
  const byLei = new Map<string, Set<number>>();
  const byRssd = new Map<string, Set<number>>();
  const add = (m: Map<string, Set<number>>, k: string | null, id: number) => {
    if (!k) return;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add(id);
  };
  for (const u of universe) {
    add(byLei, normalizeLei(u.lei), u.id);
    add(byRssd, u.rssd && /^\d+$/.test(u.rssd.trim()) ? String(Number(u.rssd)) : null, u.id);
  }
  return (lei: string, rssd: string | null): { institutionId: number | null; method: GleifLinkMethod | null; ambiguous: boolean } => {
    const leiIds = byLei.get(normalizeLei(lei) ?? "");
    const rssdIds = rssd ? byRssd.get(rssd) : undefined;
    const candidates = new Set([...(leiIds ?? []), ...(rssdIds ?? [])]);
    if (veto.blocksLei(lei) || [...candidates].some((id) => heldIds.has(id))) return { institutionId: null, method: null, ambiguous: true };
    if (candidates.size !== 1) return { institutionId: null, method: null, ambiguous: candidates.size > 1 };
    return { institutionId: [...candidates][0], method: leiIds?.size === 1 ? "lei" : "rssd", ambiguous: false };
  };
}

// ---------------------------------------------------------------------------------------------
// Level 2: golden copy relationship records

export interface GoldenCopyIndex {
  publishDate: string | null;
  rrCsvUrl: string | null;
  missingFields: string[];
}

/** Reads the golden-copy index; the RR full-file CSV link is looked for at data.rr.full_file.csv.url. */
export function parseGoldenCopyIndex(json: unknown): GoldenCopyIndex {
  const data = at(json, "data") ?? json;
  const publishDate = str(at(data, "publish_date"));
  const rrCsvUrl = str(at(data, "rr.full_file.csv.url"));
  const missingFields = [!publishDate && "data.publish_date", !rrCsvUrl && "data.rr.full_file.csv.url"].filter(Boolean) as string[];
  return { publishDate, rrCsvUrl, missingFields };
}

export const RR_COLUMNS = {
  start: "Relationship.StartNode.NodeID",
  startType: "Relationship.StartNode.NodeIDType",
  end: "Relationship.EndNode.NodeID",
  endType: "Relationship.EndNode.NodeIDType",
  type: "Relationship.RelationshipType",
  status: "Relationship.RelationshipStatus",
  registrationStatus: "Registration.RegistrationStatus",
} as const;
const RR_REQUIRED = ["start", "end", "type"] as const;

export const CONSOLIDATION_TYPES = { IS_DIRECTLY_CONSOLIDATED_BY: "direct", IS_ULTIMATELY_CONSOLIDATED_BY: "ultimate" } as const;

export interface GleifRelationship {
  childLei: string;
  parentLei: string;
  /** direct or ultimate accounting-consolidation parent. */
  kind: "direct" | "ultimate";
  relationshipStatus: string | null;
  registrationStatus: string | null;
}

export interface RrRead {
  headers: string[];
  missingFields: string[];
  rows: number;
  relationships: GleifRelationship[];
  skipped: Record<string, number>;
}

/** Row-by-row RR reader: keeps every consolidation relationship between two LEIs. */
export class RrReader {
  private header: string[] | null = null;
  private index: Partial<Record<keyof typeof RR_COLUMNS, number>> = {};
  readonly read: RrRead = { headers: [], missingFields: [], rows: 0, relationships: [], skipped: {} };

  row(cells: string[]): void {
    if (!this.header) {
      this.header = cells.map((c) => c.trim());
      this.read.headers = this.header;
      for (const [k, name] of Object.entries(RR_COLUMNS)) {
        const i = this.header.indexOf(name);
        if (i >= 0) this.index[k as keyof typeof RR_COLUMNS] = i;
      }
      this.read.missingFields = Object.entries(RR_COLUMNS).filter(([k]) => this.index[k as keyof typeof RR_COLUMNS] === undefined).map(([, v]) => v);
      return;
    }
    if (RR_REQUIRED.some((k) => this.index[k] === undefined)) return;
    this.read.rows += 1;
    const get = (k: keyof typeof RR_COLUMNS) => (this.index[k] === undefined ? null : str(cells[this.index[k]!]));
    const kind = CONSOLIDATION_TYPES[(get("type") ?? "") as keyof typeof CONSOLIDATION_TYPES];
    const bump = (key: string): void => {
      this.read.skipped[key] = (this.read.skipped[key] ?? 0) + 1;
    };
    if (!kind) return bump(`other_type:${get("type") ?? "blank"}`);
    for (const t of ["startType", "endType"] as const) {
      const v = get(t);
      if (v !== null && v.toUpperCase() !== "LEI") return bump(`node_not_lei:${v}`);
    }
    const childLei = normalizeLei(get("start"));
    const parentLei = normalizeLei(get("end"));
    if (!childLei || !parentLei) return bump("bad_lei");
    // Kept compact (no raw row): the file holds hundreds of thousands of relationships.
    this.read.relationships.push({ childLei, parentLei, kind, relationshipStatus: get("status"), registrationStatus: get("registrationStatus") });
  }
}

/** Streams the RR CSV out of its zip and returns every consolidation relationship. */
export async function fetchRelationships(url: string, options: RegistryFetchOptions = {}): Promise<RrRead & { file: string | null }> {
  const response = await registryFetch(url, { timeoutMs: 280_000, ...options });
  const reader = new RrReader();
  const csv = new CsvStreamParser((cells) => reader.row(cells));
  const body = response.body ?? new Uint8Array(await response.arrayBuffer());
  const { file } = await readZipLines(body, /\.csv$/i, (line) => csv.push(`${line}\n`));
  csv.end();
  return { ...reader.read, file };
}

/**
 * The relationships that matter for our institutions: every one whose child is a seed LEI, and
 * every one whose parent is a direct or ultimate parent of a seed (the seed's siblings and the
 * rest of its corporate family). Seeds are the LEIs we track.
 */
export function familyRelationships(all: GleifRelationship[], seeds: Set<string>): { kept: GleifRelationship[]; parents: Set<string> } {
  const parents = new Set<string>();
  for (const r of all) if (seeds.has(r.childLei)) parents.add(r.parentLei);
  const kept = all.filter((r) => seeds.has(r.childLei) || parents.has(r.parentLei));
  return { kept, parents };
}

export interface RelationshipChecks {
  rows: number;
  consolidation_relationships: number;
  kept: number;
  seeds: number;
  seeds_with_parent: number;
  parents: number;
  /** A child with two different active direct (or ultimate) parents in the file. */
  conflicting_parents: number;
  self_parent: number;
  skipped: Record<string, number>;
}

export function checkRelationships(read: RrRead, kept: GleifRelationship[], seeds: Set<string>, parents: Set<string>): RelationshipChecks {
  const per = new Map<string, Set<string>>();
  for (const r of kept) {
    if (r.relationshipStatus && r.relationshipStatus.toUpperCase() !== "ACTIVE") continue;
    const k = `${r.childLei}|${r.kind}`;
    if (!per.has(k)) per.set(k, new Set());
    per.get(k)!.add(r.parentLei);
  }
  return {
    rows: read.rows,
    consolidation_relationships: read.relationships.length,
    kept: kept.length,
    seeds: seeds.size,
    seeds_with_parent: new Set(kept.filter((r) => seeds.has(r.childLei)).map((r) => r.childLei)).size,
    parents: parents.size,
    conflicting_parents: [...per.values()].filter((s) => s.size > 1).length,
    self_parent: kept.filter((r) => r.childLei === r.parentLei).length,
    skipped: read.skipped,
  };
}

export interface Level1Checks {
  requested: number;
  returned: number;
  not_returned: number;
  linked: number;
  linked_by_method: Record<string, number>;
  ambiguous_links: number;
  unlinked: number;
  with_rssd: number;
  us_legal_address: number;
  lapsed_or_retired: number;
  skipped: Record<string, number>;
}

export function checkLevel1(requested: number, entities: GleifEntity[], links: Array<{ institutionId: number | null; method: GleifLinkMethod | null; ambiguous: boolean }>, rssds: Array<string | null>, skipped: Record<string, number>): Level1Checks {
  const byMethod: Record<string, number> = {};
  for (const l of links) if (l.method) byMethod[l.method] = (byMethod[l.method] ?? 0) + 1;
  return {
    requested,
    returned: entities.length,
    not_returned: Math.max(0, requested - entities.length),
    linked: links.filter((l) => l.institutionId !== null).length,
    linked_by_method: byMethod,
    ambiguous_links: links.filter((l) => l.ambiguous).length,
    unlinked: links.filter((l) => l.institutionId === null).length,
    with_rssd: rssds.filter(Boolean).length,
    us_legal_address: entities.filter((e) => e.legalCountry === "US").length,
    lapsed_or_retired: entities.filter((e) => e.registrationStatus !== null && e.registrationStatus.toUpperCase() !== "ISSUED").length,
    skipped,
  };
}

import { parseCsvRows } from "./fr-y9c";

/**
 * Holding-company structure from the FFIEC National Information Center bulk CSV files:
 * relationships (parent RSSD, offspring RSSD, start and end dates, level, equity share,
 * control) and attributes (legal name, entity type, city, state) for every parent entity.
 * Pure: reads downloaded file text, never writes to the database.
 *
 * Column names below come from the NIC data dictionary as remembered, not from a live file.
 * Each file's header row is checked at run time: a file missing a required column loads
 * nothing, a missing optional column is reported and its field stays null, and columns the
 * file has that we do not map are listed. Every row keeps its raw cells. Dates are YYYYMMDD
 * as filed; NIC's open-ended sentinel 99991231 is stored as a null end date (the raw row keeps
 * the original). An unparseable date stays null and is counted.
 */

const NIC_BASE = "https://www.ffiec.gov/npw/FinancialReport";
/** Unconfirmed from this sandbox. */
export const NIC_RELATIONSHIPS_URL = `${NIC_BASE}/ReturnRelationshipsZipFileCSV`;
export const NIC_ATTRIBUTES_ACTIVE_URL = `${NIC_BASE}/ReturnAttributesActiveZipFileCSV`;
export const NIC_ATTRIBUTES_CLOSED_URL = `${NIC_BASE}/ReturnAttributesClosedZipFileCSV`;

export const NIC_CSV_PATTERN = /\.csv$/i;

export const RELATIONSHIP_REQUIRED = ["ID_RSSD_PARENT", "ID_RSSD_OFFSPRING", "DT_START", "DT_END"] as const;
export const RELATIONSHIP_OPTIONAL = ["RELN_LVL", "PCT_EQUITY", "CTRL_IND", "REG_IND", "REASON_TERM_RELN", "D_DT_START", "D_DT_END"] as const;
export const ATTRIBUTE_REQUIRED = ["ID_RSSD", "NM_LGL"] as const;
export const ATTRIBUTE_OPTIONAL = ["NM_SHORT", "ENTITY_TYPE", "CITY", "STATE_ABBR_NM", "DT_OPEN", "DT_END", "BHC_IND", "FHC_IND", "ID_FDIC_CERT", "CNTRY_NM"] as const;

export interface NicHeaderCheck {
  file: string;
  missingRequired: string[];
  missingOptional: string[];
  unmapped: string[];
}

export interface NicRelationship {
  parentRssd: string;
  offspringRssd: string;
  startDate: string;
  /** Null when NIC marks the link open (99991231). */
  endDate: string | null;
  level: number | null;
  pctEquity: number | null;
  controlIndicator: string | null;
  regulatoryIndicator: string | null;
  terminationReason: string | null;
  raw: Record<string, string>;
}

export interface NicEntity {
  rssd: string;
  legalName: string;
  shortName: string | null;
  entityType: string | null;
  city: string | null;
  state: string | null;
  openDate: string | null;
  endDate: string | null;
  bhcIndicator: string | null;
  fhcIndicator: string | null;
  fdicCert: string | null;
  /** "active" or "closed": which attributes file it came from. */
  fileKind: "active" | "closed";
  raw: Record<string, string>;
}

export interface NicStructureQuality {
  relationshipRows: number;
  relationships: number;
  /** Same parent, offspring and start date more than once: the later row is dropped. */
  duplicateRelationships: number;
  badIdRows: number;
  /** Start date missing or unparseable: row skipped (start is part of the key). */
  undatedRelationships: number;
  unparseableEndDates: number;
  endBeforeStart: number;
  selfLinks: number;
  openRelationships: number;
  /** Parents with no attributes row in either attributes file. */
  parentsWithoutAttributes: number;
  invalidState: number;
}

const OPEN_END = "99991231";

/** "20240131" or "2024-01-31" or "1/31/2024 12:00:00 AM" to ISO; null when it is none of these. */
export function nicDate(raw: string | undefined): string | null {
  const text = (raw ?? "").trim();
  let m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(text);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) || Number(m[2]) > 12 || Number(m[3]) > 31 ? null : iso;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

function table(text: string, file: string, required: readonly string[], optional: readonly string[]) {
  const rows = parseCsvRows(text);
  const header = (rows[0] ?? []).map((h) => h.trim().toUpperCase().replace(/^#/, ""));
  const known = new Set([...required, ...optional]);
  const check: NicHeaderCheck = {
    file,
    missingRequired: required.filter((c) => !header.includes(c)),
    missingOptional: optional.filter((c) => !header.includes(c)),
    unmapped: header.filter((h) => h !== "" && !known.has(h)),
  };
  const records = rows.slice(1).map((row) => {
    const raw: Record<string, string> = {};
    header.forEach((h, i) => {
      const v = (row[i] ?? "").trim();
      if (h && v !== "") raw[h] = v;
    });
    return raw;
  });
  return { check, records };
}

const nullable = (v: string | undefined) => (v === undefined || v.trim() === "" ? null : v.trim());
const num = (v: string | undefined) => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface NicRelationshipRead {
  check: NicHeaderCheck;
  relationships: NicRelationship[];
  quality: Omit<NicStructureQuality, "parentsWithoutAttributes" | "invalidState">;
}

export function readNicRelationships(text: string, file = "relationships"): NicRelationshipRead {
  const { check, records } = table(text, file, RELATIONSHIP_REQUIRED, RELATIONSHIP_OPTIONAL);
  const quality = {
    relationshipRows: records.length,
    relationships: 0,
    duplicateRelationships: 0,
    badIdRows: 0,
    undatedRelationships: 0,
    unparseableEndDates: 0,
    endBeforeStart: 0,
    selfLinks: 0,
    openRelationships: 0,
  };
  if (check.missingRequired.length > 0) return { check, relationships: [], quality };
  const seen = new Set<string>();
  const relationships: NicRelationship[] = [];
  for (const raw of records) {
    const parentRssd = raw.ID_RSSD_PARENT ?? "";
    const offspringRssd = raw.ID_RSSD_OFFSPRING ?? "";
    if (!/^\d+$/.test(parentRssd) || !/^\d+$/.test(offspringRssd) || Number(parentRssd) === 0 || Number(offspringRssd) === 0) {
      quality.badIdRows += 1;
      continue;
    }
    const startDate = nicDate(raw.DT_START) ?? nicDate(raw.D_DT_START);
    if (!startDate) {
      quality.undatedRelationships += 1;
      continue;
    }
    const endRaw = raw.DT_END ?? raw.D_DT_END;
    const open = endRaw === OPEN_END;
    const endDate = open ? null : nicDate(endRaw);
    const key = `${parentRssd}|${offspringRssd}|${startDate}`;
    if (seen.has(key)) {
      quality.duplicateRelationships += 1;
      continue;
    }
    seen.add(key);
    // Blank or unreadable and not the open sentinel: stored null, counted, never guessed.
    if (!open && endDate === null) quality.unparseableEndDates += 1;
    if (open) quality.openRelationships += 1;
    if (endDate && endDate < startDate) quality.endBeforeStart += 1;
    if (parentRssd === offspringRssd) quality.selfLinks += 1;
    relationships.push({
      parentRssd,
      offspringRssd,
      startDate,
      endDate,
      level: num(raw.RELN_LVL),
      pctEquity: num(raw.PCT_EQUITY),
      controlIndicator: nullable(raw.CTRL_IND),
      regulatoryIndicator: nullable(raw.REG_IND),
      terminationReason: nullable(raw.REASON_TERM_RELN),
      raw,
    });
  }
  quality.relationships = relationships.length;
  return { check, relationships, quality };
}

export interface NicEntityRead {
  check: NicHeaderCheck;
  entities: NicEntity[];
  invalidState: number;
  badIdRows: number;
}

/** Attributes rows, kept only for the RSSDs asked for (parents), so the table stays small. */
export function readNicAttributes(text: string, fileKind: "active" | "closed", wanted: ReadonlySet<string>, file = `attributes-${fileKind}`): NicEntityRead {
  const { check, records } = table(text, file, ATTRIBUTE_REQUIRED, ATTRIBUTE_OPTIONAL);
  const out: NicEntityRead = { check, entities: [], invalidState: 0, badIdRows: 0 };
  if (check.missingRequired.length > 0) return out;
  for (const raw of records) {
    const rssd = raw.ID_RSSD ?? "";
    if (!/^\d+$/.test(rssd)) {
      out.badIdRows += 1;
      continue;
    }
    if (!wanted.has(rssd) || !raw.NM_LGL) continue;
    const stateRaw = nullable(raw.STATE_ABBR_NM);
    const state = stateRaw && /^[A-Z]{2}$/i.test(stateRaw) ? stateRaw.toUpperCase() : null;
    if (stateRaw && !state) out.invalidState += 1;
    out.entities.push({
      rssd,
      legalName: raw.NM_LGL,
      shortName: nullable(raw.NM_SHORT),
      entityType: nullable(raw.ENTITY_TYPE),
      city: nullable(raw.CITY),
      state,
      openDate: nicDate(raw.DT_OPEN),
      endDate: raw.DT_END === OPEN_END ? null : nicDate(raw.DT_END),
      bhcIndicator: nullable(raw.BHC_IND),
      fhcIndicator: nullable(raw.FHC_IND),
      fdicCert: nullable(raw.ID_FDIC_CERT),
      fileKind,
      raw,
    });
  }
  return out;
}

/** Merge active and closed attributes: an active row wins over a closed one for the same RSSD. */
export function mergeNicEntities(active: NicEntity[], closed: NicEntity[]): NicEntity[] {
  const byRssd = new Map<string, NicEntity>();
  for (const e of closed) byRssd.set(e.rssd, e);
  for (const e of active) byRssd.set(e.rssd, e);
  return [...byRssd.values()].sort((a, b) => a.rssd.localeCompare(b.rssd));
}

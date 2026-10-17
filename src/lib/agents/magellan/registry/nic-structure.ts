import { strFromU8 } from "fflate";
import { sql } from "@/lib/data-store/connection";
import { unzipSchedules } from "@/lib/regulatory/ffiec";
import { RegistryHttpError, registryFetch, type RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  NIC_ATTRIBUTES_ACTIVE_URL,
  NIC_ATTRIBUTES_CLOSED_URL,
  NIC_CSV_PATTERN,
  NIC_RELATIONSHIPS_URL,
  mergeNicEntities,
  readNicAttributes,
  readNicRelationships,
  type NicEntity,
  type NicHeaderCheck,
  type NicRelationship,
  type NicStructureQuality,
} from "@/lib/regulatory/nic-structure";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: the current NIC holding-company structure. Every parent-offspring
 * relationship with its start and end dates goes to nic_relationships, and the attributes of
 * every parent (legal name, entity type, city, state) to nic_entities, so a bank's parent and
 * its parent history can be read by RSSD. Column checks live in src/lib/regulatory/nic-structure.ts.
 *
 * NIC publishes one snapshot that includes history, so there is a single 'current' partition,
 * refreshed weekly. Rows NIC drops later are kept (fetched_at shows when each was last seen).
 * Nothing here changes institution_sources.holding_company_rssd; disagreements between it and
 * NIC's open direct parent are counted in the partition detail.
 */

export const NIC_STRUCTURE_SOURCE = "nic-structure";
export const NIC_STRUCTURE_PARSER_VERSION = 1;
export const NIC_STRUCTURE_PARTITION = "current";
const REFRESH_HOURS = 24 * 7;
const EMPTY_RETRY_HOURS = 24;
const WRITE_CHUNK = 5_000;

export function nicStructurePartitions(): string[] {
  return [NIC_STRUCTURE_PARTITION];
}

export interface RegistryNicStructureOptions {
  runId?: number | null;
  partitionKey?: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
}

export interface RegistryNicStructureResult {
  source: string;
  partitionKey: string;
  sourceUrl: string;
  relationships: number;
  parents: number;
  entities: number;
  writtenRelationships: number;
  writtenEntities: number;
  linkedBanks: number;
  parentDisagreements: number | null;
  headerChecks: NicHeaderCheck[];
  missingFiles: string[];
  quality: NicStructureQuality | null;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
}

async function fetchCsv(url: string, options: RegistryFetchOptions = {}): Promise<{ name: string; text: string } | null> {
  try {
    const response = await registryFetch(url, { timeoutMs: 300_000, ...options });
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.length < 4 || body[0] !== 0x50 || body[1] !== 0x4b) return null;
    const files = await unzipSchedules(body, NIC_CSV_PATTERN);
    const name = Object.keys(files).sort()[0];
    return name ? { name, text: strFromU8(files[name], true) } : null;
  } catch (error) {
    if (error instanceof RegistryHttpError && error.status === 404) return null;
    throw error;
  }
}

async function writeRelationships(db: RegistryDb, rows: NicRelationship[], runId: number | null): Promise<number> {
  let written = 0;
  for (let at = 0; at < rows.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      rows.slice(at, at + WRITE_CHUNK).map((r) => ({
        parent_rssd: r.parentRssd,
        offspring_rssd: r.offspringRssd,
        start_date: r.startDate,
        end_date: r.endDate,
        relationship_level: r.level,
        pct_equity: r.pctEquity,
        control_indicator: r.controlIndicator,
        regulatory_indicator: r.regulatoryIndicator,
        termination_reason: r.terminationReason,
        raw_json: r.raw,
      })),
    );
    const result = await db`
      INSERT INTO nic_relationships
        (parent_rssd, offspring_rssd, start_date, end_date, relationship_level, pct_equity, control_indicator,
         regulatory_indicator, termination_reason, raw_json, source_url, agent_run_id, fetched_at)
      SELECT x.parent_rssd, x.offspring_rssd, x.start_date, x.end_date, x.relationship_level, x.pct_equity,
             x.control_indicator, x.regulatory_indicator, x.termination_reason, x.raw_json, ${NIC_RELATIONSHIPS_URL}, ${runId}, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS x(parent_rssd text, offspring_rssd text, start_date date, end_date date, relationship_level int,
               pct_equity numeric, control_indicator text, regulatory_indicator text, termination_reason text, raw_json jsonb)
      ON CONFLICT (parent_rssd, offspring_rssd, start_date) DO UPDATE SET
        end_date = EXCLUDED.end_date,
        relationship_level = EXCLUDED.relationship_level,
        pct_equity = EXCLUDED.pct_equity,
        control_indicator = EXCLUDED.control_indicator,
        regulatory_indicator = EXCLUDED.regulatory_indicator,
        termination_reason = EXCLUDED.termination_reason,
        raw_json = EXCLUDED.raw_json,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

async function writeEntities(db: RegistryDb, rows: NicEntity[], runId: number | null): Promise<number> {
  let written = 0;
  for (let at = 0; at < rows.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      rows.slice(at, at + WRITE_CHUNK).map((e) => ({
        rssd: e.rssd,
        legal_name: e.legalName,
        short_name: e.shortName,
        entity_type: e.entityType,
        city: e.city,
        state_code: e.state,
        open_date: e.openDate,
        end_date: e.endDate,
        bhc_indicator: e.bhcIndicator,
        fhc_indicator: e.fhcIndicator,
        fdic_cert: e.fdicCert,
        file_kind: e.fileKind,
        raw_json: e.raw,
      })),
    );
    const result = await db`
      INSERT INTO nic_entities
        (rssd, legal_name, short_name, entity_type, city, state_code, open_date, end_date, bhc_indicator, fhc_indicator,
         fdic_cert, file_kind, raw_json, agent_run_id, fetched_at)
      SELECT x.rssd, x.legal_name, x.short_name, x.entity_type, x.city, x.state_code, x.open_date, x.end_date,
             x.bhc_indicator, x.fhc_indicator, x.fdic_cert, x.file_kind, x.raw_json, ${runId}, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS x(rssd text, legal_name text, short_name text, entity_type text, city text, state_code text, open_date date,
               end_date date, bhc_indicator text, fhc_indicator text, fdic_cert text, file_kind text, raw_json jsonb)
      ON CONFLICT (rssd) DO UPDATE SET
        legal_name = EXCLUDED.legal_name,
        short_name = EXCLUDED.short_name,
        entity_type = EXCLUDED.entity_type,
        city = EXCLUDED.city,
        state_code = EXCLUDED.state_code,
        open_date = EXCLUDED.open_date,
        end_date = EXCLUDED.end_date,
        bhc_indicator = EXCLUDED.bhc_indicator,
        fhc_indicator = EXCLUDED.fhc_indicator,
        fdic_cert = EXCLUDED.fdic_cert,
        file_kind = EXCLUDED.file_kind,
        raw_json = EXCLUDED.raw_json,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

/** Banks we track (FDIC rows with an RSSD) that appear as an offspring in NIC. */
async function countLinkedBanks(db: RegistryDb, offspring: string[]): Promise<number> {
  if (offspring.length === 0) return 0;
  const [row] = await db<{ linked: number }[]>`
    SELECT COUNT(DISTINCT rssd_id)::int AS linked
      FROM institution_sources
     WHERE source = 'fdic' AND rssd_id IN ${db(offspring)}
  `;
  return Number(row?.linked ?? 0);
}

/** Banks whose recorded holding_company_rssd is not any open direct parent in NIC. Read only. */
async function countParentDisagreements(db: RegistryDb): Promise<number> {
  const [row] = await db<{ disagreements: number }[]>`
    SELECT COUNT(*)::int AS disagreements
      FROM institution_sources s
     WHERE s.source = 'fdic' AND s.rssd_id IS NOT NULL AND s.holding_company_rssd IS NOT NULL
       AND EXISTS (SELECT 1 FROM nic_relationships r WHERE r.offspring_rssd = s.rssd_id AND r.end_date IS NULL)
       AND NOT EXISTS (
         SELECT 1 FROM nic_relationships r
          WHERE r.offspring_rssd = s.rssd_id AND r.end_date IS NULL AND r.parent_rssd = s.holding_company_rssd
       )
  `;
  return Number(row?.disagreements ?? 0);
}

export async function runRegistryNicStructure(options: RegistryNicStructureOptions = {}): Promise<RegistryNicStructureResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const partitionKey = options.partitionKey ?? NIC_STRUCTURE_PARTITION;
  if (partitionKey !== NIC_STRUCTURE_PARTITION) throw new Error(`Invalid NIC structure partition: ${partitionKey}`);

  const relFile = await fetchCsv(NIC_RELATIONSHIPS_URL, options.fetchOptions);
  const missingFiles: string[] = [];
  const headerChecks: NicHeaderCheck[] = [];
  let relationships: NicRelationship[] = [];
  let entities: NicEntity[] = [];
  let quality: NicStructureQuality | null = null;
  let parents = 0;
  if (!relFile) missingFiles.push(NIC_RELATIONSHIPS_URL);
  else {
    const rel = readNicRelationships(relFile.text, relFile.name);
    headerChecks.push(rel.check);
    relationships = rel.relationships;
    const parentSet = new Set(relationships.map((r) => r.parentRssd));
    parents = parentSet.size;
    const reads: Array<ReturnType<typeof readNicAttributes> & { kind: "active" | "closed" }> = [];
    for (const [url, kind] of [
      [NIC_ATTRIBUTES_ACTIVE_URL, "active"],
      [NIC_ATTRIBUTES_CLOSED_URL, "closed"],
    ] as const) {
      const file = relationships.length > 0 ? await fetchCsv(url, options.fetchOptions) : null;
      if (!file) {
        if (relationships.length > 0) missingFiles.push(url);
        continue;
      }
      const read = readNicAttributes(file.text, kind, parentSet, file.name);
      headerChecks.push(read.check);
      reads.push({ ...read, kind });
    }
    entities = mergeNicEntities(
      reads.filter((r) => r.kind === "active").flatMap((r) => r.entities),
      reads.filter((r) => r.kind === "closed").flatMap((r) => r.entities),
    );
    const named = new Set(entities.map((e) => e.rssd));
    quality = {
      ...rel.quality,
      badIdRows: rel.quality.badIdRows + reads.reduce((s, r) => s + r.badIdRows, 0),
      parentsWithoutAttributes: [...parentSet].filter((p) => !named.has(p)).length,
      invalidState: reads.reduce((s, r) => s + r.invalidState, 0),
    };
  }

  const relCheck = headerChecks[0];
  const emptyReason = !relFile
    ? "NIC relationships file could not be downloaded"
    : relCheck && relCheck.missingRequired.length > 0
      ? `NIC relationships file lacks required columns: ${relCheck.missingRequired.join(", ")}`
      : relationships.length === 0
        ? "NIC relationships file has no usable rows"
        : null;

  const base: RegistryNicStructureResult = {
    source: NIC_STRUCTURE_SOURCE,
    partitionKey,
    sourceUrl: NIC_RELATIONSHIPS_URL,
    relationships: relationships.length,
    parents,
    entities: entities.length,
    writtenRelationships: 0,
    writtenEntities: 0,
    linkedBanks: await countLinkedBanks(db, [...new Set(relationships.map((r) => r.offspringRssd))]),
    parentDisagreements: null,
    headerChecks,
    missingFiles,
    quality,
    dryRun,
    empty: emptyReason !== null,
    emptyReason,
  };
  if (dryRun) return base;

  const detail = { parser_version: NIC_STRUCTURE_PARSER_VERSION, header_checks: headerChecks, missing_files: missingFiles, quality };
  if (emptyReason !== null) {
    await recordRegistryPartition(db, {
      source: NIC_STRUCTURE_SOURCE,
      partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: NIC_RELATIONSHIPS_URL,
      runId: options.runId ?? null,
      nextAttemptAfterHours: EMPTY_RETRY_HOURS,
      detail: { ...detail, reason: emptyReason },
    });
    return base;
  }

  const runId = options.runId ?? null;
  const writtenRelationships = await writeRelationships(db, relationships, runId);
  const writtenEntities = await writeEntities(db, entities, runId);
  const parentDisagreements = await countParentDisagreements(db);
  await recordRegistryPartition(db, {
    source: NIC_STRUCTURE_SOURCE,
    partitionKey,
    status: "succeeded",
    rowCount: relationships.length,
    matchedCount: base.linkedBanks,
    insertedCount: writtenRelationships,
    sourceUrl: NIC_RELATIONSHIPS_URL,
    runId,
    nextAttemptAfterHours: REFRESH_HOURS,
    detail: {
      ...detail,
      relationships: relationships.length,
      parents,
      entities: entities.length,
      written_relationships: writtenRelationships,
      written_entities: writtenEntities,
      linked_banks: base.linkedBanks,
      parent_disagreements: parentDisagreements,
    },
  });
  return { ...base, writtenRelationships, writtenEntities, parentDisagreements };
}

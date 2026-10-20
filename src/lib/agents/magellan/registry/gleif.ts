import { sql } from "@/lib/data-store/connection";
import {
  checkLevel1,
  checkRelationships,
  createGleifLinker,
  familyRelationships,
  fetchLeiRecords,
  fetchRelationships,
  GLEIF_GOLDEN_COPY_LATEST_URL,
  GLEIF_LEVEL2_PARTITION,
  GLEIF_LICENSE_NOTE,
  GLEIF_TERMS_URL,
  gleifPartitions,
  level1ShardOf,
  leiShard,
  normalizeLei,
  parseGoldenCopyIndex,
  parseRegistrationAuthorities,
  registrationAuthoritiesUrl,
  rssdAuthorities,
  rssdOf,
  type GleifEntity,
  type GleifRelationship,
  type Level1Checks,
  type RelationshipChecks,
} from "@/lib/regulatory/gleif";
import { registryFetchJson, type RegistryFetchOptions } from "@/lib/regulatory/http";
import { isLeiMatchPartition, runGleifLeiMatch, type LeiMatchResult } from "./gleif-lei-match";
import { chunk, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step for GLEIF legal entities (free under GLEIF's terms of use).
 * - level2: the golden copy's relationship file, streamed; keeps direct and ultimate
 *   consolidation parents of every LEI we track, and the rest of those parents' families, into
 *   gleif_relationships.
 * - level1-<0..7>: GLEIF API records for the LEIs we track (institution_sources.lei) plus every
 *   LEI gleif_relationships names, in eight hash shards, into gleif_entities. Each entity links
 *   to an institution by its LEI, else by an RSSD id in the record, else stays unlinked.
 * - lei-match-*: links tracked institutions to LEIs into institution_lei_links (gleif-lei-match.ts).
 *   "The LEIs we track" above means institution_sources.lei plus every linked LEI there.
 */

export const GLEIF_SOURCE = "gleif";
export const GLEIF_PARSER_VERSION = 1;
const LEVEL1_REFRESH_HOURS = 24 * 7;
const LEVEL2_REFRESH_HOURS = 24 * 7;
const EMPTY_RETRY_HOURS = 24;
const API_BATCH = 200;
const WRITE_CHUNK = 2_000;
const RA_MAX_PAGES = 20;

export function gleifRegistryPartitions(now: Date): string[] {
  void now;
  return gleifPartitions();
}

export interface RegistryGleifOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  /** Wait between GLEIF calls in the lei-match partitions; tests pass 0. */
  spacingMs?: number;
}

export interface RegistryGleifResult {
  source: string;
  partitionKey: string;
  sourceUrl: string | null;
  publishDate: string | null;
  seeds: number;
  entities: number;
  relationships: number;
  linked: number;
  unlinked: number;
  writtenRows: number;
  missingFields: string[];
  checks: Level1Checks | RelationshipChecks | null;
  /** Set for the lei-match-* partitions. */
  leiMatch: LeiMatchResult | null;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
}

function base(options: RegistryGleifOptions): RegistryGleifResult {
  return { source: GLEIF_SOURCE, partitionKey: options.partitionKey, sourceUrl: null, publishDate: null, seeds: 0, entities: 0, relationships: 0, linked: 0, unlinked: 0, writtenRows: 0, missingFields: [], checks: null, leiMatch: null, dryRun: Boolean(options.dryRun), empty: false, emptyReason: null };
}

async function recordEmpty(db: RegistryDb, options: RegistryGleifOptions, out: RegistryGleifResult, reason: string, detail: Record<string, unknown> = {}) {
  const result = { ...out, empty: true, emptyReason: reason };
  if (options.dryRun) return result;
  await recordRegistryPartition(db, {
    source: GLEIF_SOURCE,
    partitionKey: options.partitionKey,
    status: "empty",
    rowCount: 0,
    sourceUrl: out.sourceUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: EMPTY_RETRY_HOURS,
    detail: { parser_version: GLEIF_PARSER_VERSION, license: GLEIF_LICENSE_NOTE, terms_url: GLEIF_TERMS_URL, empty_reason: reason, missing_fields: out.missingFields, ...detail },
  });
  return result;
}

async function institutionLeis(db: RegistryDb): Promise<Array<{ id: number; lei: string | null; rssd: string | null }>> {
  // The institution's own LEI, else the one the LEI match linked (institution_lei_links).
  const rows = await db<Array<{ id: number | string; lei: string | null; rssd_id: string | null }>>`
    SELECT s.id, COALESCE(NULLIF(TRIM(s.lei), ''), TRIM(l.lei)) AS lei, s.rssd_id
      FROM institution_sources s
      LEFT JOIN institution_lei_links l ON l.institution_id = s.id AND l.status = 'linked'
     WHERE s.source IN ('fdic', 'ncua')
       AND COALESCE(s.regulatory_status, 'active') <> 'inactive'
  `;
  return [...(rows as unknown as Array<Record<string, unknown>>)].map((r) => ({ id: Number(r.id), lei: (r.lei as string | null) ?? null, rssd: r.rssd_id === null || r.rssd_id === undefined ? null : String(r.rssd_id) }));
}

// ---------------------------------------------------------------------------------------------
// level2

async function writeRelationships(db: RegistryDb, rows: GleifRelationship[], publish: string, url: string, runId: number | null): Promise<number> {
  let written = 0;
  const payloadRows = rows.map((r) => ({ child_lei: r.childLei, parent_lei: r.parentLei, kind: r.kind, relationship_status: r.relationshipStatus, registration_status: r.registrationStatus }));
  for (const part of chunk(payloadRows, WRITE_CHUNK)) {
    const result = await db`
      INSERT INTO gleif_relationships
        (child_lei, parent_lei, kind, relationship_status, registration_status, last_seen_publish, source_url, agent_run_id, fetched_at)
      SELECT r.child_lei, r.parent_lei, r.kind, r.relationship_status, r.registration_status, ${publish}, ${url}, ${runId}, NOW()
        FROM jsonb_to_recordset(${JSON.stringify(part)}::jsonb)
          AS r(child_lei text, parent_lei text, kind text, relationship_status text, registration_status text)
      ON CONFLICT (child_lei, parent_lei, kind) DO UPDATE SET
        relationship_status = EXCLUDED.relationship_status,
        registration_status = EXCLUDED.registration_status,
        last_seen_publish = EXCLUDED.last_seen_publish,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

async function runLevel2(db: RegistryDb, options: RegistryGleifOptions): Promise<RegistryGleifResult> {
  let out = { ...base(options), sourceUrl: GLEIF_GOLDEN_COPY_LATEST_URL };
  const index = parseGoldenCopyIndex(await registryFetchJson<unknown>(GLEIF_GOLDEN_COPY_LATEST_URL, options.fetchOptions));
  out = { ...out, publishDate: index.publishDate, missingFields: index.missingFields };
  if (!index.rrCsvUrl || !index.publishDate) return recordEmpty(db, options, out, `The golden-copy index did not carry ${index.missingFields.join(", ")}`);
  const seeds = new Set((await institutionLeis(db)).map((r) => normalizeLei(r.lei)).filter((l): l is string => l !== null));
  out = { ...out, sourceUrl: index.rrCsvUrl, seeds: seeds.size };
  if (seeds.size === 0) return recordEmpty(db, options, out, "No tracked institution carries an LEI, so there is no family to look up");
  const read = await fetchRelationships(index.rrCsvUrl, options.fetchOptions);
  out = { ...out, missingFields: [...index.missingFields, ...read.missingFields] };
  if (read.missingFields.some((f) => /StartNode\.NodeID$|EndNode\.NodeID$|RelationshipType$/.test(f))) {
    return recordEmpty(db, options, out, `The relationship file lacks required columns: ${read.missingFields.join(", ")}`, { headers: read.headers.slice(0, 40), file: read.file });
  }
  const { kept, parents } = familyRelationships(read.relationships, seeds);
  const checks = checkRelationships(read, kept, seeds, parents);
  out = { ...out, relationships: kept.length, checks };
  const detail = { parser_version: GLEIF_PARSER_VERSION, license: GLEIF_LICENSE_NOTE, terms_url: GLEIF_TERMS_URL, publish_date: index.publishDate, file: read.file, missing_fields: out.missingFields, checks };
  if (kept.length === 0) return recordEmpty(db, options, out, "None of our LEIs has a reported consolidation parent in this publish", detail);
  if (options.dryRun) return out;
  const written = await writeRelationships(db, kept, index.publishDate, index.rrCsvUrl, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: GLEIF_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: kept.length,
    insertedCount: written,
    sourceUrl: index.rrCsvUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: LEVEL2_REFRESH_HOURS,
    detail: { ...detail, written_rows: written },
  });
  return { ...out, writtenRows: written };
}

// ---------------------------------------------------------------------------------------------
// level1

async function rssdAuthorityIds(options: RegistryGleifOptions): Promise<{ ids: Set<string>; names: string[]; problem: string | null }> {
  const found: Array<{ id: string; name: string }> = [];
  for (let page = 1; page <= RA_MAX_PAGES; page += 1) {
    const parsed = parseRegistrationAuthorities(await registryFetchJson<unknown>(registrationAuthoritiesUrl(page), options.fetchOptions));
    if (!parsed.valid) return { ids: new Set(), names: [], problem: "GLEIF's registration-authority list had no data array" };
    found.push(...rssdAuthorities(parsed.authorities));
    if (parsed.authorities.length === 0 || parsed.lastPage === null || page >= parsed.lastPage) break;
  }
  return {
    ids: new Set(found.map((a) => a.id)),
    names: found.map((a) => `${a.id}: ${a.name}`),
    problem: found.length === 0 ? "No registration authority named National Information Center was found, so no RSSD ids were read" : null,
  };
}

async function writeEntities(db: RegistryDb, entities: GleifEntity[], rssds: Array<string | null>, links: Array<{ institutionId: number | null; method: string | null }>, url: string, runId: number | null): Promise<number> {
  let written = 0;
  const rows = entities.map((e, i) => ({
    lei: e.lei,
    legal_name: e.legalName,
    jurisdiction: e.jurisdiction,
    legal_country: e.legalCountry,
    legal_region: e.legalRegion,
    legal_state: e.legalState,
    legal_city: e.legalCity,
    hq_country: e.hqCountry,
    category: e.category,
    legal_form_id: e.legalFormId,
    entity_status: e.entityStatus,
    registration_status: e.registrationStatus,
    registered_at_id: e.registeredAtId,
    registered_as: e.registeredAs,
    rssd_id: rssds[i],
    last_update: e.lastUpdate,
    next_renewal: e.nextRenewal,
    institution_id: links[i]?.institutionId ?? null,
    link_method: links[i]?.method ?? null,
    raw: e.raw,
  }));
  for (const part of chunk(rows, WRITE_CHUNK)) {
    // Parent LEIs come from the newest relationship publish; a child with two parents of one
    // kind (reported in the level2 checks) takes the lowest LEI so the pick is repeatable.
    const result = await db`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(part)}::jsonb)
          AS x(lei text, legal_name text, jurisdiction text, legal_country text, legal_region text, legal_state text,
               legal_city text, hq_country text, category text, legal_form_id text, entity_status text,
               registration_status text, registered_at_id text, registered_as text, rssd_id text, last_update text,
               next_renewal text, institution_id bigint, link_method text, raw jsonb)
      ),
      rel AS (
        SELECT child_lei, kind, MIN(parent_lei) AS parent_lei
          FROM gleif_relationships
         WHERE last_seen_publish = (SELECT MAX(last_seen_publish) FROM gleif_relationships)
           AND child_lei IN (SELECT lei FROM r)
           AND COALESCE(UPPER(relationship_status), 'ACTIVE') = 'ACTIVE'
         GROUP BY child_lei, kind
      )
      INSERT INTO gleif_entities
        (lei, legal_name, jurisdiction, legal_country, legal_region, legal_state, legal_city, hq_country, category,
         legal_form_id, entity_status, registration_status, registered_at_id, registered_as, rssd_id, last_update,
         next_renewal, direct_parent_lei, ultimate_parent_lei, institution_id, link_method, raw_json, source_url,
         agent_run_id, fetched_at)
      SELECT r.lei, r.legal_name, r.jurisdiction, r.legal_country, r.legal_region, r.legal_state, r.legal_city,
             r.hq_country, r.category, r.legal_form_id, r.entity_status, r.registration_status, r.registered_at_id,
             r.registered_as, r.rssd_id, r.last_update, r.next_renewal,
             (SELECT parent_lei FROM rel WHERE rel.child_lei = r.lei AND rel.kind = 'direct'),
             (SELECT parent_lei FROM rel WHERE rel.child_lei = r.lei AND rel.kind = 'ultimate'),
             r.institution_id, r.link_method, COALESCE(r.raw, '{}'::jsonb), ${url}, ${runId}, NOW()
        FROM r
      ON CONFLICT (lei) DO UPDATE SET
        legal_name = EXCLUDED.legal_name,
        jurisdiction = EXCLUDED.jurisdiction,
        legal_country = EXCLUDED.legal_country,
        legal_region = EXCLUDED.legal_region,
        legal_state = EXCLUDED.legal_state,
        legal_city = EXCLUDED.legal_city,
        hq_country = EXCLUDED.hq_country,
        category = EXCLUDED.category,
        legal_form_id = EXCLUDED.legal_form_id,
        entity_status = EXCLUDED.entity_status,
        registration_status = EXCLUDED.registration_status,
        registered_at_id = EXCLUDED.registered_at_id,
        registered_as = EXCLUDED.registered_as,
        rssd_id = EXCLUDED.rssd_id,
        last_update = EXCLUDED.last_update,
        next_renewal = EXCLUDED.next_renewal,
        direct_parent_lei = EXCLUDED.direct_parent_lei,
        ultimate_parent_lei = EXCLUDED.ultimate_parent_lei,
        institution_id = EXCLUDED.institution_id,
        link_method = EXCLUDED.link_method,
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

async function runLevel1(db: RegistryDb, options: RegistryGleifOptions, shard: number): Promise<RegistryGleifResult> {
  let out = base(options);
  const universe = await institutionLeis(db);
  const relRows = await db<Array<{ lei: string }>>`
    SELECT child_lei AS lei FROM gleif_relationships
     WHERE last_seen_publish = (SELECT MAX(last_seen_publish) FROM gleif_relationships)
    UNION
    SELECT parent_lei FROM gleif_relationships
     WHERE last_seen_publish = (SELECT MAX(last_seen_publish) FROM gleif_relationships)
  `;
  const all = new Set<string>();
  for (const u of universe) {
    const l = normalizeLei(u.lei);
    if (l) all.add(l);
  }
  for (const r of [...(relRows as unknown as Array<{ lei: string }>)]) {
    const l = normalizeLei(r.lei);
    if (l) all.add(l);
  }
  const seeds = [...all].filter((l) => leiShard(l) === shard).sort();
  out = { ...out, seeds: seeds.length };
  if (seeds.length === 0) return recordEmpty(db, options, out, all.size === 0 ? "No tracked institution carries an LEI yet" : `No LEI falls in shard ${shard}`);
  const ra = await rssdAuthorityIds(options);
  const entities: GleifEntity[] = [];
  const missing = new Set<string>();
  const skipped: Record<string, number> = {};
  let firstUrl: string | null = null;
  for (const batch of chunk(seeds, API_BATCH)) {
    const read = await fetchLeiRecords(batch, options.fetchOptions);
    firstUrl ??= read.url;
    if (!read.valid) {
      missing.add("data");
      continue;
    }
    read.missingFields.forEach((f) => missing.add(f));
    for (const [k, v] of Object.entries(read.skipped)) skipped[k] = (skipped[k] ?? 0) + v;
    entities.push(...read.entities);
  }
  const rssds = entities.map((e) => rssdOf(e, ra.ids));
  const link = createGleifLinker(universe);
  const links = entities.map((e, i) => link(e.lei, rssds[i]));
  const checks = checkLevel1(seeds.length, entities, links, rssds, skipped);
  out = { ...out, sourceUrl: firstUrl, entities: entities.length, linked: checks.linked, unlinked: checks.unlinked, missingFields: [...missing], checks };
  const returned = new Set(entities.map((e) => e.lei));
  const detail = {
    parser_version: GLEIF_PARSER_VERSION,
    license: GLEIF_LICENSE_NOTE,
    terms_url: GLEIF_TERMS_URL,
    rssd_authorities: ra.names,
    rssd_authority_problem: ra.problem,
    missing_fields: out.missingFields,
    not_returned_examples: seeds.filter((l) => !returned.has(l)).slice(0, 20),
    checks,
  };
  if (entities.length === 0) return recordEmpty(db, options, out, "GLEIF returned no records for this shard's LEIs", detail);
  if (options.dryRun) return out;
  const written = await writeEntities(db, entities, rssds, links, firstUrl ?? "", options.runId ?? null);
  await recordRegistryPartition(db, {
    source: GLEIF_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: entities.length,
    matchedCount: checks.linked,
    unmatchedCount: checks.unlinked,
    insertedCount: written,
    sourceUrl: firstUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: LEVEL1_REFRESH_HOURS,
    detail: { ...detail, written_rows: written },
  });
  return { ...out, writtenRows: written };
}

export async function runRegistryGleif(options: RegistryGleifOptions): Promise<RegistryGleifResult> {
  const db = options.db ?? sql;
  if (isLeiMatchPartition(options.partitionKey)) {
    const m = await runGleifLeiMatch({ runId: options.runId, partitionKey: options.partitionKey, dryRun: options.dryRun, db, fetchOptions: options.fetchOptions, spacingMs: options.spacingMs });
    return {
      ...base(options),
      sourceUrl: m.sourceUrl,
      entities: m.read,
      linked: m.coverage?.linked ?? 0,
      unlinked: m.coverage ? m.coverage.institutions - m.coverage.linked : 0,
      writtenRows: m.writtenRows,
      missingFields: Array.isArray(m.detail.missing_fields) ? (m.detail.missing_fields as string[]) : [],
      leiMatch: m,
      empty: m.empty,
      emptyReason: m.emptyReason,
    };
  }
  if (options.partitionKey === GLEIF_LEVEL2_PARTITION) return runLevel2(db, options);
  const shard = level1ShardOf(options.partitionKey);
  if (shard === null) throw new Error(`Invalid GLEIF partition: ${options.partitionKey}`);
  return runLevel1(db, options, shard);
}

import { readFdicIdentityHolds, lockFdicIdentityHolds } from "@/lib/data-store/fdic-identity-holds";
import { FDIC_IDENTITY_HOLD_REASON } from "@/lib/regulatory/gleif-identity-holds";
import { getLeiLinkCoverage, type LeiLinkCoverage } from "@/lib/data-store/locations-gleif-aggregates";
import {
  GLEIF_LEI_MATCH_PARTITIONS,
  GLEIF_LICENSE_NOTE,
  GLEIF_TERMS_URL,
  parseLeiRecords,
  parseRegistrationAuthorities,
  registrationAuthoritiesUrl,
  type GleifEntity,
  type RegistrationAuthority,
} from "@/lib/regulatory/gleif";
import {
  authorityLeiRecordsUrl,
  keyAuthorities,
  lastPageOf,
  mergeLeiLink,
  nameStateSearchUrl,
  proposeByKey,
  proposeByNameState,
  proposeOwnLei,
  vetoLeiLink,
  type KeyBasis,
  type LeiLinkRow,
  type LeiMatchBasis,
  type LeiProposal,
  type LeiUniverseInstitution,
} from "@/lib/regulatory/gleif-lei-match";
import { registryFetchJson, type RegistryFetchOptions } from "@/lib/regulatory/http";
import { chunk, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * GLEIF LEI matching for tracked institutions (#1868), as partitions of the `gleif` registry
 * source. Writes institution_lei_links only; the level-1 and level-2 partitions then seed from
 * every linked LEI.
 *
 * - lei-match-rssd / -fdic / -ncua: walk GLEIF's records registered with the Fed's National
 *   Information Center, the FDIC or the NCUA (authorities found by name in GLEIF's list) and
 *   link by the registered id. The RSSD partition also links institutions that carry their own LEI.
 * - lei-match-name: up to NAME_BATCH institutions per run that no key linked, one GLEIF search
 *   each by exact legal name and state.
 *
 * The production database is under connection strain (Oct 2026), so every statement runs inside a
 * transaction with a statement timeout, writes go in chunks of WRITE_CHUNK, and one run writes at
 * most KEY_WRITE_CAP changed rows (key partitions) or NAME_BATCH rows (name partition). Work left
 * over is picked up by the next run of the same partition, an hour (or two) later.
 */

export const LEI_MATCH_PARTITIONS: Record<(typeof GLEIF_LEI_MATCH_PARTITIONS)[number], KeyBasis | "name_state"> = {
  "lei-match-rssd": "rssd",
  "lei-match-fdic": "fdic_cert",
  "lei-match-ncua": "ncua_charter",
  "lei-match-name": "name_state",
};

export const LEI_MATCH_PARSER_VERSION = 1;
/** Every statement this module runs is bounded by this (SET LOCAL statement_timeout in bounded()). */
export const STATEMENT_TIMEOUT = "15s";
export const WRITE_CHUNK = 250;
export const KEY_WRITE_CAP = 1_000;
export const NAME_BATCH = 60;
const WALK_MAX_PAGES = 75;
const WALK_PAGE_SIZE = 200;
const RA_MAX_PAGES = 20;
/** GLEIF asks API users to stay under 60 requests a minute. */
const DEFAULT_SPACING_MS = 1_100;
const REFRESH_HOURS = 24 * 7;
const MORE_KEY_HOURS = 1;
const MORE_NAME_HOURS = 2;
const EMPTY_RETRY_HOURS = 24;
const NAME_RECHECK_DAYS = 30;

export interface LeiMatchOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  /** Wait between GLEIF calls; tests pass 0. */
  spacingMs?: number;
}

export interface LeiMatchResult {
  partitionKey: string;
  basis: KeyBasis | "name_state";
  sourceUrl: string | null;
  /** GLEIF records read (key walks) or institutions searched (name). */
  read: number;
  proposals: Record<string, number>;
  /** Rows that differ from what is stored. */
  changes: number;
  writtenRows: number;
  /** Changed rows left for the next run (key partitions) or institutions still to search (name: 1 means more remain). */
  remaining: number;
  coverage: LeiLinkCoverage | null;
  empty: boolean;
  emptyReason: string | null;
  dryRun: boolean;
  detail: Record<string, unknown>;
}

export function isLeiMatchPartition(partitionKey: string): boolean {
  return (GLEIF_LEI_MATCH_PARTITIONS as readonly string[]).includes(partitionKey);
}

const sleep = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/** Every statement in `fn` runs in one transaction under the statement timeout. */
export async function bounded<T>(db: RegistryDb, fn: (tx: RegistryDb) => Promise<T>): Promise<T> {
  return (await db.begin(async (raw) => {
    const tx = raw as unknown as RegistryDb;
    await tx`SET LOCAL statement_timeout = '15s'`;
    return fn(tx);
  })) as T;
}

const ACTIVE_INSTITUTIONS = `s.source IN ('fdic', 'ncua') AND COALESCE(s.regulatory_status, 'active') <> 'inactive'`;

function toUniverse(rows: Array<Record<string, unknown>>): LeiUniverseInstitution[] {
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return rows.map((r) => ({ id: Number(r.id), source: String(r.source), lei: s(r.lei), linkedLei: s(r.linked_lei ?? r.link_lei), identityLeis: Array.isArray(r.candidate_leis) ? r.candidate_leis.map(String) : [], rssd: s(r.rssd_id), cert: s(r.cert_number), charter: s(r.ncua_charter_id), name: s(r.institution_name), state: s(r.state_code) }));
}

function toLinks(rows: Array<Record<string, unknown>>): Map<number, LeiLinkRow> {
  return new Map(
    rows.map((r) => {
      const id = Number(r.institution_id);
      return [id, {
        institutionId: id,
        status: r.status as LeiLinkRow["status"],
        lei: r.lei ? String(r.lei).trim() : null,
        basis: (r.match_basis as LeiMatchBasis | null) ?? null,
        key: (r.match_key as string | null) ?? null,
        candidates: Array.isArray(r.candidate_leis) ? (r.candidate_leis as string[]).map((c) => String(c).trim()).sort() : [],
        reason: (r.reason as string | null) ?? null,
      }];
    }),
  );
}

async function readUniverse(db: RegistryDb): Promise<LeiUniverseInstitution[]> {
  const rows = await bounded(db, (tx) => tx`
    SELECT s.id, s.source, s.lei, l.lei AS linked_lei, l.candidate_leis, s.rssd_id, s.cert_number, s.ncua_charter_id, s.institution_name, s.state_code
      FROM institution_sources s LEFT JOIN institution_lei_links l ON l.institution_id=s.id
     WHERE ${tx.unsafe(ACTIVE_INSTITUTIONS)}
  `);
  return toUniverse([...(rows as unknown as Array<Record<string, unknown>>)]);
}

async function readLinks(db: RegistryDb): Promise<Map<number, LeiLinkRow>> {
  const rows = await bounded(db, (tx) => tx`
    SELECT institution_id, status, lei, match_basis, match_key, candidate_leis, reason FROM institution_lei_links
  `);
  return toLinks([...(rows as unknown as Array<Record<string, unknown>>)]);
}

/**
 * Upserts rows in chunks, each chunk its own bounded transaction. `nameOnly` leaves key-based
 * rows alone even if a key partition wrote one since this run read the table.
 */
async function writeLinks(db: RegistryDb, rows: LeiLinkRow[], sourceUrl: string | null, runId: number | null, nameOnly: boolean): Promise<number> {
  let written = 0;
  for (const part of chunk(rows, WRITE_CHUNK)) {
    const result = await bounded(db, async (tx) => {
      await tx`SET LOCAL lock_timeout = '2s'`;
      // Serialize canonical crosswalk writers before taking the hold snapshot. A veto
      // computed before an ON CONFLICT wait must not overwrite newly held candidates.
      await tx`LOCK TABLE institution_sources IN SHARE MODE`;
      await tx`LOCK TABLE institution_lei_links IN SHARE ROW EXCLUSIVE MODE`;
      await lockFdicIdentityHolds(tx);
      const holds = await readFdicIdentityHolds(tx);
      const canonical = await tx`SELECT s.id, s.source, s.cert_number, s.lei, l.lei AS linked_lei, l.candidate_leis FROM institution_sources s LEFT JOIN institution_lei_links l ON l.institution_id=s.id WHERE s.id IN ${tx(part.map((row) => row.institutionId))}`;
      const safe = part.map((row) => {
        const inst = canonical.find((candidate) => Number(candidate.id) === row.institutionId);
        if (!inst) throw new Error("GLEIF canonical institution disappeared before write");
        return vetoLeiLink(row, { id: row.institutionId, source: String(inst.source), cert: inst.cert_number == null ? null : String(inst.cert_number), lei: inst.lei == null ? null : String(inst.lei), linkedLei: inst.linked_lei == null ? null : String(inst.linked_lei), identityLeis: Array.isArray(inst.candidate_leis) ? inst.candidate_leis.map(String) : [] }, holds);
      });
      const payload = safe.map((r) => ({ institution_id: r.institutionId, status: r.status, lei: r.lei, match_basis: r.basis, match_key: r.key, candidate_leis: r.candidates, reason: r.reason }));
      return tx`
      INSERT INTO institution_lei_links
        (institution_id, status, lei, match_basis, match_key, candidate_leis, reason, source_url, agent_run_id, checked_at)
      SELECT r.institution_id, r.status, r.lei, r.match_basis, r.match_key,
             ARRAY(SELECT jsonb_array_elements_text(r.candidate_leis)), r.reason, ${sourceUrl}, ${runId}, NOW()
        FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
          AS r(institution_id bigint, status text, lei text, match_basis text, match_key text, candidate_leis jsonb, reason text)
        JOIN institution_sources s ON s.id = r.institution_id
      ON CONFLICT (institution_id) DO UPDATE SET
        status = EXCLUDED.status,
        lei = EXCLUDED.lei,
        match_basis = EXCLUDED.match_basis,
        match_key = EXCLUDED.match_key,
        candidate_leis = EXCLUDED.candidate_leis,
        reason = EXCLUDED.reason,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        checked_at = NOW()
      WHERE ${nameOnly}::boolean = FALSE
         OR institution_lei_links.match_basis IS NULL
         OR institution_lei_links.match_basis = 'name_state'
         OR EXCLUDED.reason = ${FDIC_IDENTITY_HOLD_REASON}
      RETURNING 1
    `;
    });
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

async function authoritiesFor(basis: KeyBasis, options: LeiMatchOptions): Promise<{ found: RegistrationAuthority[]; problem: string | null }> {
  const found: RegistrationAuthority[] = [];
  for (let page = 1; page <= RA_MAX_PAGES; page += 1) {
    const parsed = parseRegistrationAuthorities(await registryFetchJson<unknown>(registrationAuthoritiesUrl(page), options.fetchOptions));
    if (!parsed.valid) return { found: [], problem: "GLEIF's registration-authority list had no data array" };
    found.push(...keyAuthorities(parsed.authorities, basis));
    if (parsed.authorities.length === 0 || parsed.lastPage === null || page >= parsed.lastPage) break;
    await sleep(options.spacingMs ?? DEFAULT_SPACING_MS);
  }
  return { found, problem: found.length === 0 ? `No GLEIF registration authority for ${basis} was found by name` : null };
}

interface WalkResult {
  entities: GleifEntity[];
  pages: number;
  /** Every page of every authority was read in this run, from page 1, and the filter held. */
  complete: boolean;
  /** Page each authority's walk continues from next run, for a register longer than WALK_MAX_PAGES. */
  resume: Record<string, number>;
  problems: string[];
  firstUrl: string | null;
  missingFields: string[];
}

async function walkAuthorities(authorities: RegistrationAuthority[], options: LeiMatchOptions, startAt: Record<string, number>): Promise<WalkResult> {
  const out: WalkResult = { entities: [], pages: 0, complete: true, resume: {}, problems: [], firstUrl: null, missingFields: [] };
  const missing = new Set<string>();
  for (const authority of authorities) {
    const first = Number.isInteger(startAt[authority.id]) && startAt[authority.id] > 1 ? startAt[authority.id] : 1;
    // A walk that resumed mid-register did not see the earlier pages this run, so it cannot clear links.
    if (first > 1) out.complete = false;
    const stop = first + WALK_MAX_PAGES - 1;
    for (let page = first; page <= stop; page += 1) {
      const url = authorityLeiRecordsUrl(authority.id, page, WALK_PAGE_SIZE);
      out.firstUrl ??= url;
      const json = await registryFetchJson<unknown>(url, options.fetchOptions);
      out.pages += 1;
      const read = parseLeiRecords(json);
      if (!read.valid) {
        out.complete = false;
        out.problems.push(`${authority.id} page ${page}: no data array`);
        break;
      }
      read.missingFields.forEach((f) => missing.add(f));
      // A filter the API ignored would return other authorities' records: stop rather than walk the whole register.
      const foreign = read.entities.filter((e) => e.registeredAtId !== authority.id).length;
      if (foreign > 0) {
        out.complete = false;
        out.problems.push(`${authority.id}: ${foreign} of ${read.entities.length} records on page ${page} are registered elsewhere, so the authority filter did not hold`);
        break;
      }
      out.entities.push(...read.entities);
      const last = lastPageOf(json);
      if (read.entities.length === 0 || last === null || page >= last) {
        if (last === null && read.entities.length === WALK_PAGE_SIZE) {
          out.complete = false;
          out.problems.push(`${authority.id}: no page count in the response, stopped after page ${page}`);
        }
        break;
      }
      if (page === stop) {
        out.complete = false;
        out.resume[authority.id] = page + 1;
        out.problems.push(`${authority.id}: ${last} pages; read ${first} to ${page}, the next run continues from ${page + 1}`);
      }
      await sleep(options.spacingMs ?? DEFAULT_SPACING_MS);
    }
  }
  out.missingFields = [...missing];
  return out;
}

function countKinds(proposals: Iterable<LeiProposal>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of proposals) out[`${p.basis}:${p.kind}`] = (out[`${p.basis}:${p.kind}`] ?? 0) + 1;
  return out;
}

async function coverage(db: RegistryDb): Promise<LeiLinkCoverage | null> {
  try {
    return await bounded(db, (tx) => getLeiLinkCoverage(tx));
  } catch {
    return null;
  }
}

async function record(options: LeiMatchOptions, out: LeiMatchResult, status: "succeeded" | "empty", nextHours: number): Promise<LeiMatchResult> {
  if (options.dryRun) return out;
  await recordRegistryPartition(options.db, {
    source: "gleif",
    partitionKey: options.partitionKey,
    status,
    rowCount: out.read,
    matchedCount: out.coverage?.linked,
    unmatchedCount: out.coverage ? out.coverage.ambiguous + out.coverage.unmatched : undefined,
    insertedCount: out.writtenRows,
    sourceUrl: out.sourceUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: nextHours,
    detail: {
      parser_version: LEI_MATCH_PARSER_VERSION,
      license: GLEIF_LICENSE_NOTE,
      terms_url: GLEIF_TERMS_URL,
      basis: out.basis,
      proposals: out.proposals,
      changes: out.changes,
      written_rows: out.writtenRows,
      remaining: out.remaining,
      coverage: out.coverage,
      ...(out.emptyReason ? { empty_reason: out.emptyReason } : {}),
      ...out.detail,
    },
  });
  return out;
}

function base(options: LeiMatchOptions, basis: KeyBasis | "name_state"): LeiMatchResult {
  return { partitionKey: options.partitionKey, basis, sourceUrl: null, read: 0, proposals: {}, changes: 0, writtenRows: 0, remaining: 0, coverage: null, empty: false, emptyReason: null, dryRun: Boolean(options.dryRun), detail: {} };
}

async function runKeyMatch(options: LeiMatchOptions, basis: KeyBasis): Promise<LeiMatchResult> {
  const { db } = options;
  let out = base(options, basis);
  const holds = await bounded(db, (tx) => readFdicIdentityHolds(tx));
  const universe = await readUniverse(db);
  const existing = await readLinks(db);
  const rounds: Array<Map<number, LeiProposal>> = [];
  if (basis === "rssd") rounds.push(proposeOwnLei(universe, holds));

  const authorities = await authoritiesFor(basis, options);
  const startAt = await walkResume(db, options.partitionKey);
  let walk: WalkResult | null = null;
  if (authorities.found.length > 0) {
    walk = await walkAuthorities(authorities.found, options, startAt);
    const byKey = proposeByKey(universe, walk.entities, basis, new Set(authorities.found.map((a) => a.id)), holds);
    // A partial walk cannot say a key has no record, so it only adds links.
    if (!walk.complete) for (const [id, p] of byKey) if (p.kind === "none") byKey.delete(id);
    rounds.push(byKey);
  }

  const changed: LeiLinkRow[] = [];
  for (const inst of universe) {
    const before = existing.get(inst.id) ?? null;
    let row = before;
    for (const round of rounds) {
      const p = round.get(inst.id);
      if (!p) continue;
      row = mergeLeiLink(row, p, inst.id) ?? row;
    }
    if (row) row = vetoLeiLink(row, inst, holds);
    if (row && row !== before) changed.push(row);
  }
  const toWrite = changed.slice(0, KEY_WRITE_CAP);
  // Writes left over: read the same pages again next run rather than move on past them.
  const resume = changed.length > toWrite.length ? startAt : (walk?.resume ?? {});
  out = {
    ...out,
    sourceUrl: walk?.firstUrl ?? null,
    read: walk?.entities.length ?? 0,
    proposals: countKinds(rounds.flatMap((r) => [...r.values()])),
    changes: changed.length,
    remaining: changed.length - toWrite.length,
    detail: {
      authorities: authorities.found.map((a) => `${a.id}: ${a.name}`),
      authority_problem: authorities.problem,
      pages: walk?.pages ?? 0,
      walk_complete: walk?.complete ?? false,
      walk_problems: walk?.problems ?? [],
      walk_resume: resume,
      missing_fields: walk?.missingFields ?? [],
      tracked_institutions: universe.length,
      examples: toWrite.slice(0, 10).map((r) => ({ institution_id: r.institutionId, status: r.status, lei: r.lei, basis: r.basis, key: r.key, reason: r.reason })),
    },
  };
  if (options.dryRun) return out;
  const written = toWrite.length > 0 ? await writeLinks(db, toWrite, out.sourceUrl, options.runId ?? null, false) : 0;
  out = { ...out, writtenRows: written, coverage: await coverage(db) };
  if (authorities.found.length === 0 && written === 0) {
    return record(options, { ...out, empty: true, emptyReason: authorities.problem }, "empty", EMPTY_RETRY_HOURS);
  }
  return record(options, out, "succeeded", out.remaining > 0 || Object.keys(resume).length > 0 ? MORE_KEY_HOURS : REFRESH_HOURS);
}

/** Where the last run of this partition left each authority's walk (detail.walk_resume). */
async function walkResume(db: RegistryDb, partitionKey: string): Promise<Record<string, number>> {
  const rows = await bounded(db, (tx) => tx`
    SELECT detail->'walk_resume' AS resume FROM registry_ingest_partitions
     WHERE source = 'gleif' AND partition_key = ${partitionKey}
  `);
  const raw = [...(rows as unknown as Array<{ resume: unknown }>)][0]?.resume;
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object") for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (Number.isInteger(v)) out[k] = v as number;
  return out;
}

async function keyMatchHasRun(db: RegistryDb): Promise<boolean> {
  const rows = await bounded(db, (tx) => tx`
    SELECT 1 FROM registry_ingest_partitions
     WHERE source = 'gleif' AND partition_key = 'lei-match-rssd' AND status IN ('succeeded', 'empty')
     LIMIT 1
  `);
  return [...(rows as unknown as unknown[])].length > 0;
}

async function runNameMatch(options: LeiMatchOptions): Promise<LeiMatchResult> {
  const { db } = options;
  const holds = await bounded(db, (tx) => readFdicIdentityHolds(tx));
  let out = base(options, "name_state");
  // Key links first, so the name search spends its calls only on institutions no key linked.
  if (!(await keyMatchHasRun(db))) {
    out = { ...out, empty: true, emptyReason: "Waits for the first RSSD match (lei-match-rssd)" };
    return record(options, out, "empty", MORE_NAME_HOURS);
  }
  const rows = await bounded(db, (tx) => tx`
    SELECT s.id, s.source, s.lei, s.rssd_id, s.cert_number, s.ncua_charter_id, s.institution_name, s.state_code,
           l.institution_id, l.status, l.lei AS link_lei, l.match_basis, l.match_key, l.candidate_leis, l.reason
      FROM institution_sources s
      LEFT JOIN institution_lei_links l ON l.institution_id = s.id
     WHERE ${tx.unsafe(ACTIVE_INSTITUTIONS)}
       AND (l.institution_id IS NULL
            OR ((l.match_basis IS NULL OR l.match_basis = 'name_state')
                AND l.checked_at < NOW() - (${NAME_RECHECK_DAYS} * INTERVAL '1 day')))
     ORDER BY l.checked_at NULLS FIRST, s.id
     LIMIT ${NAME_BATCH + 1}
  `);
  const list = [...(rows as unknown as Array<Record<string, unknown>>)];
  const batch = list.slice(0, NAME_BATCH);
  const universe = toUniverse(batch);
  const existing = toLinks(batch.filter((r) => r.institution_id !== null && r.institution_id !== undefined).map((r) => ({ ...r, lei: r.link_lei })));
  const proposals: LeiProposal[] = [];
  const toWrite: LeiLinkRow[] = [];
  const errorExamples: string[] = [];
  let errorCount = 0;
  let firstUrl: string | null = null;
  for (const [i, inst] of universe.entries()) {
    if (i > 0) await sleep(options.spacingMs ?? DEFAULT_SPACING_MS);
    let proposal: LeiProposal;
    if (!inst.name || !inst.state) {
      proposal = proposeByNameState(inst, [], holds);
    } else {
      const url = nameStateSearchUrl(inst.name, inst.state);
      firstUrl ??= url;
      try {
        const read = parseLeiRecords(await registryFetchJson<unknown>(url, options.fetchOptions));
        if (!read.valid) throw new Error("no data array");
        proposal = proposeByNameState(inst, read.entities, holds);
      } catch (error) {
        errorCount += 1;
        if (errorExamples.length < 10) errorExamples.push(`${inst.id}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }
    proposals.push(proposal);
    const before = existing.get(inst.id) ?? null;
    // Every searched institution is written, so its check date moves on even when nothing changed.
    const row = mergeLeiLink(before, proposal, inst.id) ?? before;
    if (row) toWrite.push(vetoLeiLink(row, inst, holds));
  }
  if (batch.length > 0 && errorCount === batch.length) throw new Error(`Every GLEIF name search failed: ${errorExamples.slice(0, 3).join("; ")}`);
  out = {
    ...out,
    sourceUrl: firstUrl,
    read: batch.length,
    proposals: countKinds(proposals),
    changes: toWrite.length,
    remaining: list.length > NAME_BATCH ? 1 : 0,
    detail: {
      searched: batch.length,
      search_errors: errorCount,
      search_error_examples: errorExamples,
      examples: toWrite.filter((r) => r.status !== "unmatched").slice(0, 10).map((r) => ({ institution_id: r.institutionId, status: r.status, lei: r.lei, key: r.key, candidates: r.candidates })),
    },
  };
  if (options.dryRun) return out;
  const written = toWrite.length > 0 ? await writeLinks(db, toWrite, firstUrl, options.runId ?? null, true) : 0;
  out = { ...out, writtenRows: written, coverage: await coverage(db) };
  if (batch.length === 0) return record(options, { ...out, empty: true, emptyReason: "Every tracked institution is linked by a key or was searched by name in the last 30 days" }, "empty", REFRESH_HOURS);
  return record(options, out, "succeeded", out.remaining > 0 ? MORE_NAME_HOURS : REFRESH_HOURS);
}

export async function runGleifLeiMatch(options: LeiMatchOptions): Promise<LeiMatchResult> {
  const basis = isLeiMatchPartition(options.partitionKey) ? LEI_MATCH_PARTITIONS[options.partitionKey as keyof typeof LEI_MATCH_PARTITIONS] : null;
  if (!basis) throw new Error(`Invalid GLEIF LEI match partition: ${options.partitionKey}`);
  return basis === "name_state" ? runNameMatch(options) : runKeyMatch(options, basis);
}

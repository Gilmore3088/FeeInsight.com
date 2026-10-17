import { sql } from "@/lib/data-store/connection";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  PAYMENT_NETWORK_PARTITION_KEYS,
  PAYMENT_NETWORK_SOURCES,
  checkInterchangeFigures,
  checkMembershipList,
  checkOsmLocations,
  createMembershipMatcher,
  dedupeListed,
  fetchPublicPage,
  isPaymentNetworkPartition,
  linkOsmLocation,
  OSM_ATTRIBUTION,
  osmPartitionKeys,
  OVERPASS_URL,
  overpassQuery,
  overpassUrl,
  parseOsmPartition,
  readInterchangeTables,
  readMembershipCsv,
  readMembershipHtml,
  readOverpass,
  regIiListLinks,
  statedDateIso,
  statedListDate,
  type InterchangeFigure,
  type ListedInstitution,
  type MembershipMatch,
  type MembershipRead,
  type OsmLink,
  type OsmLocation,
  type PaymentNetworkSourceConfig,
  type UniverseInstitution,
} from "@/lib/regulatory/payment-networks";
import { chunk, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step for payment networks, one published list per partition:
 * - reg-ii-not-exempt, reg-ii-exempt: institution_network_memberships, one
 *   row per listed institution per snapshot (the publisher's stated as-of date, else the fetch
 *   date), matched to institution_sources by RSSD, cert / charter, or exact normalized name and
 *   state; unmatched rows are kept with institution_id NULL.
 * - reg-ii-survey: the Fed's interchange fee tables into reg_ii_interchange_figures, cell by cell.
 * - osm-XX: OpenStreetMap ATMs and bank branches for one state into osm_financial_locations
 *   (ODbL, attribution on every row), linked by exact normalized operator or brand name only.
 * Allpoint, MoneyPass and CO-OP publish locators, not lists; locators are not read.
 */

export const PAYMENT_NETWORKS_SOURCE = "payment-networks";
export const PAYMENT_NETWORKS_PARSER_VERSION = 1;
const LIST_REFRESH_HOURS = 24 * 7;
const SURVEY_REFRESH_HOURS = 24 * 90;
const OSM_REFRESH_HOURS = 24 * 30;
const EMPTY_RETRY_HOURS = 24;
const ROBOTS_RETRY_HOURS = 24 * 30;
const WRITE_CHUNK = 2_000;

/** Published lists first, then the interchange tables, then one OpenStreetMap partition per state. */
export function paymentNetworksPartitions(now: Date): string[] {
  void now;
  return [...PAYMENT_NETWORK_PARTITION_KEYS, ...osmPartitionKeys()];
}

export interface RegistryPaymentNetworksOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
}

export interface RegistryPaymentNetworksResult {
  source: string;
  partitionKey: string;
  network: string | null;
  asOf: string;
  sourceUrl: string;
  /** The page or file the rows were read from (the linked CSV for the covered list). */
  readUrl: string | null;
  statedDate: string | null;
  listedRows: number;
  matchedRows: number;
  unmatchedRows: number;
  figures: number;
  writtenRows: number;
  unrecognisedHeaders: string[];
  missingColumns: string[];
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
}

function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

async function loadUniverse(db: RegistryDb): Promise<UniverseInstitution[]> {
  const rows = await db<Array<{ id: number | string; institution_name: string; state_code: string | null; rssd_id: string | null; cert_number: string | null; ncua_charter_id: string | null; source: string }>>`
    SELECT id, institution_name, state_code, rssd_id, cert_number, ncua_charter_id, source
      FROM institution_sources
     WHERE source IN ('fdic', 'ncua')
       AND COALESCE(regulatory_status, 'active') <> 'inactive'
  `;
  return [...(rows as unknown as Array<Record<string, unknown>>)].map((r) => ({
    id: Number(r.id),
    name: String(r.institution_name ?? ""),
    state: (r.state_code as string | null) ?? null,
    rssd: (r.rssd_id as string | null) ?? null,
    cert: (r.cert_number as string | null) ?? null,
    ncuaCharter: (r.ncua_charter_id as string | null) ?? null,
    source: String(r.source),
  }));
}

async function previousRowCount(db: RegistryDb, network: string, asOf: string): Promise<number | null> {
  const rows = await db<Array<{ rows: number | null }>>`
    SELECT COUNT(*)::int AS rows
      FROM institution_network_memberships
     WHERE network = ${network}
       AND as_of = (SELECT MAX(as_of) FROM institution_network_memberships WHERE network = ${network} AND as_of < ${asOf}::date)
  `;
  const first = [...(rows as unknown as Array<{ rows: number | null }>)][0];
  return first && first.rows ? Number(first.rows) : null;
}

interface ListRead {
  read: MembershipRead;
  readUrl: string | null;
  statedDate: string | null;
  emptyReason: string | null;
  linkNotes: Array<{ href: string; text: string; format: string }>;
}

async function readList(config: PaymentNetworkSourceConfig, options: RegistryFetchOptions | undefined): Promise<ListRead> {
  const network = config.network!;
  const empty = (reason: string, extra: Partial<ListRead> = {}): ListRead => ({
    read: readMembershipHtml(network, ""),
    readUrl: null,
    statedDate: null,
    emptyReason: reason,
    linkNotes: [],
    ...extra,
  });
  const page = await fetchPublicPage(config.pageUrl, options);
  if (page.status === "robots_disallowed") return empty("The site's robots.txt asks crawlers like ours not to read this page");
  if (page.status === "not_found") return empty("The page is gone (404); its address needs checking");
  const statedDate = statedListDate(page.text);
  // fed-list: the page links its "Exempt" and "Not Exempt" lists; this partition follows one.
  // CSV or HTML is read; a PDF or spreadsheet is named in the run, not read.
  const which = config.fedList ?? "not-exempt";
  const links = regIiListLinks(page.text, page.url, which);
  const readable = links.find((l) => l.format === "csv") ?? links.find((l) => l.format === "html");
  const linkNotes = links.map((l) => ({ href: l.href, text: l.text, format: l.format }));
  const linkDate = links.map((l) => statedListDate(l.text)).find(Boolean) ?? null;
  if (!readable) {
    const formats = [...new Set(links.map((l) => l.format))];
    return empty(
      links.length === 0
        ? `No link to the "${which}" issuer list was found on the Regulation II page`
        : `The "${which}" issuer list is published only as ${formats.join(", ")}, which this loader does not read`,
      { statedDate: linkDate ?? statedDate, linkNotes, readUrl: page.url },
    );
  }
  const file = await fetchPublicPage(readable.href, options);
  if (file.status !== "ok") return empty(`The linked list could not be read (${file.status})`, { statedDate: linkDate ?? statedDate, linkNotes, readUrl: readable.href });
  const read = readable.format === "csv" ? readMembershipCsv(network, file.text) : readMembershipHtml(network, file.text);
  const fileDate = readable.format === "csv" ? null : statedListDate(file.text);
  return { read, readUrl: file.url, statedDate: linkDate ?? fileDate ?? statedDate, emptyReason: null, linkNotes };
}

async function writeMemberships(
  db: RegistryDb,
  network: string,
  asOf: string,
  url: string,
  rows: ListedInstitution[],
  matches: MembershipMatch[],
  runId: number | null,
): Promise<number> {
  let written = 0;
  const payloadRows = rows.map((r, i) => ({
    listed_key: r.listedKey,
    institution_id: matches[i]?.institutionId ?? null,
    match_method: matches[i]?.method ?? null,
    listed_name: r.listedName,
    normalized_name: r.normalizedName,
    listed_city: r.city,
    listed_state: r.state,
    listed_rssd: r.rssd,
    listed_cert: r.cert ?? r.ncuaCharter,
    raw: r.raw,
  }));
  for (const part of chunk(payloadRows, WRITE_CHUNK)) {
    const result = await db`
      INSERT INTO institution_network_memberships
        (network, as_of, listed_key, institution_id, match_method, listed_name, normalized_name, listed_city,
         listed_state, listed_rssd, listed_cert, raw_json, source_url, agent_run_id, fetched_at)
      SELECT ${network}, ${asOf}::date, r.listed_key, r.institution_id, r.match_method, r.listed_name, r.normalized_name,
             r.listed_city, r.listed_state, r.listed_rssd, r.listed_cert, r.raw, ${url}, ${runId}, NOW()
        FROM jsonb_to_recordset(${JSON.stringify(part)}::jsonb)
          AS r(listed_key text, institution_id bigint, match_method text, listed_name text, normalized_name text,
               listed_city text, listed_state text, listed_rssd text, listed_cert text, raw jsonb)
      ON CONFLICT (network, as_of, listed_key) DO UPDATE SET
        institution_id = EXCLUDED.institution_id,
        match_method = EXCLUDED.match_method,
        listed_name = EXCLUDED.listed_name,
        normalized_name = EXCLUDED.normalized_name,
        listed_city = EXCLUDED.listed_city,
        listed_state = EXCLUDED.listed_state,
        listed_rssd = EXCLUDED.listed_rssd,
        listed_cert = EXCLUDED.listed_cert,
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

async function writeFigures(db: RegistryDb, asOf: string, url: string, figures: InterchangeFigure[], runId: number | null): Promise<number> {
  // The same table, row and column read twice keeps the first cell; the duplicate is counted in the checks.
  const seen = new Set<string>();
  const unique = figures.filter((f) => {
    const key = `${f.tableIndex}|${f.rowLabel}|${f.columnLabel}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let written = 0;
  for (const part of chunk(unique, WRITE_CHUNK)) {
    const payload = JSON.stringify(
      part.map((f) => ({
        table_index: f.tableIndex,
        table_title: f.tableTitle,
        row_label: f.rowLabel,
        column_label: f.columnLabel,
        value_text: f.valueText,
        value: f.value,
        unit: f.unit,
        survey_year: f.surveyYear,
      })),
    );
    const result = await db`
      INSERT INTO reg_ii_interchange_figures
        (page_url, table_index, table_title, row_label, column_label, value_text, value, unit, survey_year, as_of, agent_run_id, fetched_at)
      SELECT ${url}, r.table_index, r.table_title, r.row_label, r.column_label, r.value_text, r.value, r.unit, r.survey_year,
             ${asOf}::date, ${runId}, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS r(table_index int, table_title text, row_label text, column_label text, value_text text, value numeric, unit text, survey_year int)
      ON CONFLICT (page_url, table_index, row_label, column_label) DO UPDATE SET
        table_title = EXCLUDED.table_title,
        value_text = EXCLUDED.value_text,
        value = EXCLUDED.value,
        unit = EXCLUDED.unit,
        survey_year = EXCLUDED.survey_year,
        as_of = EXCLUDED.as_of,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

async function runSurvey(options: RegistryPaymentNetworksOptions, config: PaymentNetworkSourceConfig, db: RegistryDb, asOf: string): Promise<RegistryPaymentNetworksResult> {
  const dryRun = Boolean(options.dryRun);
  const page = await fetchPublicPage(config.pageUrl, options.fetchOptions);
  const parsed = page.status === "ok" ? readInterchangeTables(page.text) : { tables: 0, figures: [], raggedRows: 0 };
  const emptyReason =
    page.status === "robots_disallowed"
      ? "The site's robots.txt asks crawlers like ours not to read this page"
      : page.status === "not_found"
        ? "The page is gone (404); its address needs checking"
        : parsed.tables === 0
          ? "The page has no HTML table to read"
          : parsed.figures.length < config.minRows
            ? `Only ${parsed.figures.length} table cells were found, too few to be the interchange tables`
            : null;
  const base: RegistryPaymentNetworksResult = {
    source: PAYMENT_NETWORKS_SOURCE,
    partitionKey: options.partitionKey,
    network: null,
    asOf,
    sourceUrl: config.pageUrl,
    readUrl: page.status === "ok" ? page.url : null,
    statedDate: page.status === "ok" ? statedListDate(page.text) : null,
    listedRows: 0,
    matchedRows: 0,
    unmatchedRows: 0,
    figures: parsed.figures.length,
    writtenRows: 0,
    unrecognisedHeaders: [],
    missingColumns: [],
    dryRun,
    empty: emptyReason !== null,
    emptyReason,
  };
  if (dryRun) return base;
  const detail = {
    parser_version: PAYMENT_NETWORKS_PARSER_VERSION,
    label: config.label,
    read_url: base.readUrl,
    stated_date: base.statedDate,
    tables: parsed.tables,
    ragged_rows: parsed.raggedRows,
    figure_checks: checkInterchangeFigures(parsed.figures),
    table_titles: [...new Set(parsed.figures.map((f) => f.tableTitle ?? `table ${f.tableIndex + 1}`))],
  };
  if (emptyReason !== null) {
    await recordRegistryPartition(db, {
      source: PAYMENT_NETWORKS_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: config.pageUrl,
      runId: options.runId ?? null,
      nextAttemptAfterHours: page.status === "robots_disallowed" ? ROBOTS_RETRY_HOURS : EMPTY_RETRY_HOURS,
      detail: { ...detail, reason: emptyReason },
    });
    return base;
  }
  const writtenRows = await writeFigures(db, asOf, base.readUrl ?? config.pageUrl, parsed.figures, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: PAYMENT_NETWORKS_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: parsed.figures.length,
    insertedCount: writtenRows,
    sourceUrl: config.pageUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: SURVEY_REFRESH_HOURS,
    detail: { ...detail, written_rows: writtenRows },
  });
  return { ...base, writtenRows };
}

async function writeOsmLocations(
  db: RegistryDb,
  state: string,
  asOf: string,
  url: string,
  locations: OsmLocation[],
  links: OsmLink[],
  runId: number | null,
): Promise<number> {
  let written = 0;
  const rows = locations.map((l, i) => ({
    osm_type: l.osmType,
    osm_id: l.osmId,
    kind: l.kind,
    name: l.name,
    operator: l.operator,
    brand: l.brand,
    network_tag: l.networkTag,
    lat: l.lat,
    lon: l.lon,
    addr_city: l.city,
    addr_state: l.addrState,
    institution_id: links[i]?.institutionId ?? null,
    match_method: links[i]?.method ?? null,
    match_field: links[i]?.field ?? null,
    tags: l.tags,
  }));
  for (const part of chunk(rows, WRITE_CHUNK)) {
    const result = await db`
      INSERT INTO osm_financial_locations
        (osm_type, osm_id, partition_state, kind, name, operator, brand, network_tag, lat, lon, addr_city, addr_state,
         institution_id, match_method, match_field, tags, attribution, as_of, source_url, agent_run_id, fetched_at)
      SELECT r.osm_type, r.osm_id, ${state}, r.kind, r.name, r.operator, r.brand, r.network_tag, r.lat, r.lon, r.addr_city,
             r.addr_state, r.institution_id, r.match_method, r.match_field, r.tags, ${OSM_ATTRIBUTION}, ${asOf}::date, ${url},
             ${runId}, NOW()
        FROM jsonb_to_recordset(${JSON.stringify(part)}::jsonb)
          AS r(osm_type text, osm_id bigint, kind text, name text, operator text, brand text, network_tag text, lat float8,
               lon float8, addr_city text, addr_state text, institution_id bigint, match_method text, match_field text, tags jsonb)
      ON CONFLICT (osm_type, osm_id) DO UPDATE SET
        partition_state = EXCLUDED.partition_state,
        kind = EXCLUDED.kind,
        name = EXCLUDED.name,
        operator = EXCLUDED.operator,
        brand = EXCLUDED.brand,
        network_tag = EXCLUDED.network_tag,
        lat = EXCLUDED.lat,
        lon = EXCLUDED.lon,
        addr_city = EXCLUDED.addr_city,
        addr_state = EXCLUDED.addr_state,
        institution_id = EXCLUDED.institution_id,
        match_method = EXCLUDED.match_method,
        match_field = EXCLUDED.match_field,
        tags = EXCLUDED.tags,
        attribution = EXCLUDED.attribution,
        as_of = EXCLUDED.as_of,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

async function runOsm(options: RegistryPaymentNetworksOptions, state: string, db: RegistryDb, asOf: string): Promise<RegistryPaymentNetworksResult> {
  const dryRun = Boolean(options.dryRun);
  const url = overpassUrl(state);
  const page = await fetchPublicPage(url, { timeoutMs: 200_000, retries: 2, ...options.fetchOptions });
  let json: unknown = null;
  let parseError: string | null = null;
  if (page.status === "ok") {
    try {
      json = JSON.parse(page.text);
    } catch {
      parseError = "Overpass did not answer with JSON (it may be overloaded or rate-limiting)";
    }
  }
  const read = readOverpass(json);
  const emptyReason =
    page.status === "robots_disallowed"
      ? "overpass-api.de's robots.txt asks crawlers like ours not to call the API"
      : page.status === "not_found"
        ? "The Overpass endpoint answered 404"
        : parseError ??
          (!read.valid
            ? "The Overpass answer had no elements array"
            : read.remark && /error|timed out|timeout/i.test(read.remark)
              ? `Overpass stopped early: ${read.remark}`
              : read.locations.length === 0
                ? `OpenStreetMap returned no ATMs or banks for ${state}; the state boundary lookup may have failed`
                : null);
  const universe = emptyReason === null ? await loadUniverse(db) : [];
  const match = createMembershipMatcher(universe);
  const links = emptyReason === null ? read.locations.map((l) => linkOsmLocation(match, l, state)) : [];
  const linked = links.filter((l) => l.institutionId !== null).length;
  const base: RegistryPaymentNetworksResult = {
    source: PAYMENT_NETWORKS_SOURCE,
    partitionKey: options.partitionKey,
    network: "osm",
    asOf,
    sourceUrl: OVERPASS_URL,
    readUrl: page.status === "ok" ? OVERPASS_URL : null,
    statedDate: null,
    listedRows: read.locations.length,
    matchedRows: linked,
    unmatchedRows: emptyReason === null ? read.locations.length - linked : 0,
    figures: 0,
    writtenRows: 0,
    unrecognisedHeaders: [],
    missingColumns: [],
    dryRun,
    empty: emptyReason !== null,
    emptyReason,
  };
  if (dryRun) return base;
  const detail = {
    parser_version: PAYMENT_NETWORKS_PARSER_VERSION,
    label: `OpenStreetMap ATMs and bank branches, ${state}`,
    attribution: OSM_ATTRIBUTION,
    license: "ODbL-1.0",
    query: overpassQuery(state),
    remark: read.remark,
    checks: checkOsmLocations(read, links, state),
  };
  if (emptyReason !== null) {
    await recordRegistryPartition(db, {
      source: PAYMENT_NETWORKS_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: OVERPASS_URL,
      runId: options.runId ?? null,
      nextAttemptAfterHours: page.status === "robots_disallowed" ? ROBOTS_RETRY_HOURS : EMPTY_RETRY_HOURS,
      detail: { ...detail, reason: emptyReason },
    });
    return base;
  }
  const writtenRows = await writeOsmLocations(db, state, asOf, OVERPASS_URL, read.locations, links, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: PAYMENT_NETWORKS_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: read.locations.length,
    matchedCount: linked,
    unmatchedCount: read.locations.length - linked,
    insertedCount: writtenRows,
    sourceUrl: OVERPASS_URL,
    runId: options.runId ?? null,
    nextAttemptAfterHours: OSM_REFRESH_HOURS,
    detail: { ...detail, written_rows: writtenRows },
  });
  return { ...base, writtenRows };
}

export async function runRegistryPaymentNetworks(options: RegistryPaymentNetworksOptions): Promise<RegistryPaymentNetworksResult> {
  const db = options.db ?? sql;
  const fetchedOn = isoDate(options.now ?? new Date());
  const osmState = parseOsmPartition(options.partitionKey);
  if (osmState) return runOsm(options, osmState, db, fetchedOn);
  if (!isPaymentNetworkPartition(options.partitionKey)) throw new Error(`Invalid payment-network partition: ${options.partitionKey}`);
  const config = PAYMENT_NETWORK_SOURCES[options.partitionKey];
  if (config.kind === "tables") return runSurvey(options, config, db, fetchedOn);

  const network = config.network!;
  const dryRun = Boolean(options.dryRun);
  const list = await readList(config, options.fetchOptions);
  // The snapshot date is the as-of date the publisher gives its list; the fetch date when it gives none.
  const statedIso = statedDateIso(list.statedDate);
  const asOf = statedIso ?? fetchedOn;
  const { rows, duplicates } = dedupeListed(list.read.rows);
  const tooFew = list.emptyReason === null && rows.length < config.minRows;
  const emptyReason =
    list.emptyReason ??
    (rows.length === 0
      ? "No participant list was found in the page HTML; the page may build its list with JavaScript, which a plain fetch cannot read"
      : tooFew
        ? `Only ${rows.length} names were read, fewer than the ${config.minRows} a full list would hold; the page layout was not recognised`
        : null);

  const universe = emptyReason === null ? await loadUniverse(db) : [];
  const match = createMembershipMatcher(universe);
  const matches = emptyReason === null ? rows.map(match) : [];
  const matchedRows = matches.filter((m) => m.institutionId !== null).length;
  const base: RegistryPaymentNetworksResult = {
    source: PAYMENT_NETWORKS_SOURCE,
    partitionKey: options.partitionKey,
    network,
    asOf,
    sourceUrl: config.pageUrl,
    readUrl: list.readUrl,
    statedDate: list.statedDate,
    listedRows: rows.length,
    matchedRows,
    unmatchedRows: emptyReason === null ? rows.length - matchedRows : 0,
    figures: 0,
    writtenRows: 0,
    unrecognisedHeaders: list.read.unrecognisedHeaders,
    missingColumns: list.read.missingRoles,
    dryRun,
    empty: emptyReason !== null,
    emptyReason,
  };
  if (dryRun) return base;

  const previous = emptyReason === null ? await previousRowCount(db, network, asOf) : null;
  const detail = {
    parser_version: PAYMENT_NETWORKS_PARSER_VERSION,
    label: config.label,
    network,
    as_of: asOf,
    as_of_basis: statedIso ? "stated_by_publisher" : "fetch_date",
    read_url: list.readUrl,
    stated_date: list.statedDate,
    shape: list.read.shape,
    headers: list.read.headers,
    unrecognised_headers: list.read.unrecognisedHeaders,
    missing_columns: list.read.missingRoles,
    skipped_lists: list.read.skippedLists,
    skipped_list_examples: list.read.skippedListExamples,
    linked_files: list.linkNotes,
    checks: checkMembershipList({ ...list.read, rows }, matches, duplicates, previous),
  };
  if (emptyReason !== null) {
    await recordRegistryPartition(db, {
      source: PAYMENT_NETWORKS_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: config.pageUrl,
      runId: options.runId ?? null,
      nextAttemptAfterHours: list.emptyReason?.includes("robots.txt") ? ROBOTS_RETRY_HOURS : EMPTY_RETRY_HOURS,
      detail: { ...detail, reason: emptyReason },
    });
    return base;
  }

  const writtenRows = await writeMemberships(db, network, asOf, list.readUrl ?? config.pageUrl, rows, matches, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: PAYMENT_NETWORKS_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rows.length,
    matchedCount: matchedRows,
    unmatchedCount: rows.length - matchedRows,
    insertedCount: writtenRows,
    sourceUrl: config.pageUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: LIST_REFRESH_HOURS,
    detail: { ...detail, written_rows: writtenRows },
  });
  return { ...base, writtenRows };
}

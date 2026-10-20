import { sql } from "@/lib/data-store/connection";
import { startAgentRun } from "@/lib/agents/run-store";
import type { AgentRunTriggerSource } from "@/lib/agents/types";
import { FDIC_FINANCIALS_SOURCE, FDIC_FILING_LAG_DAYS } from "@/lib/agents/magellan/registry/fdic-financials";
import { FDIC_UNIVERSE_PARSER_VERSION, FDIC_UNIVERSE_SOURCE } from "@/lib/agents/magellan/registry/fdic-universe";
import { FFIEC_OVERDRAFT_PARSER_VERSION, FFIEC_OVERDRAFT_SOURCE, ffiecOverdraftPartitions } from "@/lib/agents/magellan/registry/ffiec-overdraft";
import { FDIC_SOD_SOURCE, SOD_FIRST_YEAR, latestSodYear } from "@/lib/agents/magellan/registry/fdic-sod";
import {
  FFIEC_CALL_DETAIL_PARSER_VERSION,
  FFIEC_CALL_DETAIL_SOURCE,
  ffiecCallDetailPartitions,
} from "@/lib/agents/magellan/registry/ffiec-call-detail";
import {
  NCUA_EXTRAS_FIRST,
  NCUA_EXTRAS_PARSER_VERSION,
  NCUA_EXTRAS_SOURCE,
  ncuaExtrasPartitions,
} from "@/lib/agents/magellan/registry/ncua-extras";
import {
  FDIC_HISTORY_FIRST_YEAR,
  FDIC_HISTORY_PARSER_VERSION,
  FDIC_HISTORY_SOURCE,
  fdicHistoryPartitions,
} from "@/lib/agents/magellan/registry/fdic-history";
import { BEIGE_BOOK_SOURCE, beigeBookCandidates, FED_INDICATORS_PARSER_VERSION, FRED_SOURCE } from "@/lib/agents/magellan/registry/fed";
import { NCUA_FILING_LAG_DAYS, NCUA_FINANCIALS_SOURCE, NCUA_PARSER_VERSION } from "@/lib/agents/magellan/registry/ncua-financials";
import { CFPB_PARSER_VERSION, CFPB_SOURCE } from "@/lib/agents/magellan/registry/cfpb";
import { CENSUS_ACS_PARSER_VERSION, CENSUS_ACS_SOURCE, censusAcsPartitions } from "@/lib/agents/magellan/registry/census-acs";
import { IRS_ZIP_INCOME_SOURCE, irsZipIncomePartitions } from "@/lib/agents/magellan/registry/irs-zip-income";
import { NCUA_BRANCHES_SOURCE, ncuaBranchPartitions } from "@/lib/agents/magellan/registry/ncua-branches";
import { SEC_FILINGS_SOURCE, SEC_LINKS_PARSER_VERSION, SEC_LINKS_SOURCE, secBatchPartitions } from "@/lib/agents/magellan/registry/sec";
import {
  CFPB_CARD_AGREEMENTS_PARSER_VERSION,
  CFPB_CARD_AGREEMENTS_SOURCE,
  cfpbCardAgreementsPartitions,
} from "@/lib/agents/magellan/registry/cfpb-card-agreements";
import {
  UBPR_FIRST,
  UBPR_PEER_GROUPS_PARSER_VERSION,
  UBPR_PEER_GROUPS_SOURCE,
  ubprPeerGroupsPartitions,
} from "@/lib/agents/magellan/registry/ubpr-peer-groups";
import { FR_Y9C_FIRST, FR_Y9C_PARSER_VERSION, FR_Y9C_SOURCE, frY9cPartitions } from "@/lib/agents/magellan/registry/fr-y9c";
import { NIC_STRUCTURE_PARSER_VERSION, NIC_STRUCTURE_SOURCE, nicStructurePartitions } from "@/lib/agents/magellan/registry/nic-structure";
import { craPartitions, CRA_PARSER_VERSION, CRA_SOURCE } from "@/lib/agents/magellan/registry/cra";
import { CRA_LENDING_FIRST_YEAR } from "@/lib/regulatory/cra";
import {
  DESIGNATION_LISTS_PARSER_VERSION,
  DESIGNATION_LISTS_SOURCE,
  designationListsPartitions,
} from "@/lib/agents/magellan/registry/designation-lists";
import {
  HMDA_APOR_PARSER_VERSION,
  HMDA_APOR_SOURCE,
  HMDA_PARSER_VERSION,
  HMDA_SOURCE,
  hmdaPartitions,
} from "@/lib/agents/magellan/registry/hmda";
import {
  PAYMENT_NETWORKS_PARSER_VERSION,
  PAYMENT_NETWORKS_SOURCE,
  paymentNetworksPartitions,
} from "@/lib/agents/magellan/registry/payment-networks";
import {
  INDUSTRY_EVENTS_PARSER_VERSION,
  INDUSTRY_EVENTS_SOURCE,
  industryEventsPartitions,
} from "@/lib/agents/magellan/registry/industry-events";
import { BEA_PARSER_VERSION, BRANCH_TRACT_PARSER_VERSION, ECONOMY_DEFINITIONS, ECONOMY_PARSER_VERSION, ECONOMY_SOURCES, REMITTANCE_PARSER_VERSION } from "@/lib/agents/magellan/registry/economy";
import { MAKING_ENDS_MEET_PARSER_VERSION, MAKING_ENDS_MEET_SOURCE } from "@/lib/agents/magellan/registry/making-ends-meet";
import { PAYDAY_REPORTS_PARSER_VERSION, PAYDAY_REPORTS_SOURCE, paydayReportsPartitions } from "@/lib/agents/magellan/registry/payday-reports";
import {
  STATE_DEPOSITORIES_PARSER_VERSION,
  STATE_DEPOSITORIES_SOURCE,
  STATE_NONBANK_LENDERS_PARSER_VERSION,
  STATE_NONBANK_LENDERS_SOURCE,
  stateDepositoriesPartitions,
  stateNonbankLendersPartitions,
  URBAN_DEBT_PARSER_VERSION,
  URBAN_DEBT_SOURCE,
} from "@/lib/agents/magellan/registry/state-lists";
import {
  ALLTHEPLACES_PARSER_VERSION,
  ALLTHEPLACES_SOURCE,
  alltheplacesPartitions,
} from "@/lib/agents/magellan/registry/alltheplaces";
import { GLEIF_PARSER_VERSION, GLEIF_SOURCE, gleifRegistryPartitions } from "@/lib/agents/magellan/registry/gleif";
import { SEC_MARKET_VALUE_PARSER_VERSION, SEC_MARKET_VALUE_SOURCE, secMarketValuePartitions } from "@/lib/agents/magellan/registry/sec-market-value";
import { BANK_MERGER_ORDERS_PARSER_VERSION, BANK_MERGER_ORDERS_SOURCE, bankMergerOrdersPartitions } from "@/lib/agents/magellan/registry/bank-merger-orders";
import { BLS_OEWS_PARSER_VERSION, BLS_OEWS_SOURCE, blsOewsPartitions } from "@/lib/agents/magellan/registry/bls-oews";
import { USDA_FARM_PARSER_VERSION, USDA_FARM_SOURCE, usdaFarmPartitions } from "@/lib/agents/magellan/registry/usda-farm";
import {
  USCOURTS_BANKRUPTCY_PARSER_VERSION,
  USCOURTS_BANKRUPTCY_SOURCE,
  uscourtsBankruptcyPartitions,
} from "@/lib/agents/magellan/registry/uscourts-bankruptcy";
import { MARKET_GROWTH_DEFINITIONS, MARKET_GROWTH_PARSER_VERSION } from "@/lib/agents/magellan/registry/market-growth";
import { SMALLBIZ_PAYMENTS_DEFINITIONS, SMALLBIZ_PAYMENTS_PARSER_VERSION } from "@/lib/agents/magellan/registry/smallbiz-payments";
import { NATIONAL_CREDIT_DEFINITIONS, NATIONAL_CREDIT_PARSER_VERSION } from "@/lib/agents/magellan/registry/national-credit";
import { BANK_ZELLE_SOURCE } from "@/lib/agents/magellan/registry/bank-zelle";
import { CALL_REPORT_SUMMARIES_SOURCE } from "@/lib/agents/magellan/registry/call-report-summaries";
import { BANK_ZELLE_MATCHER_VERSION } from "@/lib/agents/magellan/registry/bank-zelle-match";
import { REGISTRY_SOURCES } from "@/lib/agents/magellan/registry";
import { isProviderStep } from "@/lib/agents/types";
import { STATE_BILLS_PARTITION, STATE_BILLS_SOURCE } from "@/lib/agents/magellan/registry/state-bills";
import { FEDERAL_BILLS_PARTITION, FEDERAL_BILLS_SOURCE } from "@/lib/agents/magellan/registry/federal-bills";
import { ENFORCEMENT_MATCHER_VERSION, ENFORCEMENT_SOURCE } from "@/lib/agents/magellan/registry/enforcement";
import { STATE_ENFORCEMENT_PARSER_VERSION, STATE_ENFORCEMENT_SOURCE } from "@/lib/agents/magellan/registry/state-enforcement";
import { STATE_NEWS_PARSER_VERSION, STATE_REG_NEWS_SOURCE } from "@/lib/agents/magellan/registry/state-reg-news";
import { STATE_BILL_NEWS_SOURCE } from "@/lib/agents/magellan/registry/state-bill-news";
import { CFPB_FIRST_YEAR } from "@/lib/regulatory/cfpb";
import { readLatestTableSizes } from "@/lib/agents/atlas/storage-retention";
import { sourcesHeldForSize } from "@/lib/agents/hoovie/size-budgets";
import { HOOVIE_AGENT } from "@/lib/agents/hoovie/names";
import {
  compareQuarters,
  latestPublishableQuarter,
  parseQuarterKey,
  quarterKey,
  quartersNewestFirst,
  type Quarter,
} from "@/lib/regulatory/quarters";

/**
 * Schedules Magellan regulatory-registry runs from the cron tick.
 *
 * One registry run is in flight at a time and each run processes exactly one
 * partition (a universe sync or one call-report quarter). That keeps every tick
 * well inside the function time limit, leaves room for state lanes, and turns a
 * multi-year backfill into a visible sequence of small runs that resumes on its
 * own after any failure.
 *
 * Order: the roster sources in PRIORITY_REGISTRY_SOURCES first, then round-robin across
 * the rest, newest partitions first, then history back to REGISTRY_BACKFILL_FROM
 * (default 2010Q1).
 */

/**
 * The run marker every registry run carries (`params_json.source`), before and after #1865 moved
 * the runs from Magellan to Hoovie. It stays as it is: the registry tick, the queued-run lookup and
 * the one-run-at-a-time check find registry runs by it, never by agent name, so runs written under
 * either name are found alike.
 */
export const REGISTRY_RUN_SOURCE = "magellan.registry";
export const DEFAULT_BACKFILL_FROM: Quarter = { year: 2010, quarter: 1 };
/** If a scheduled run dies without recording an outcome, retry after this long. */
const CLAIM_RETRY_HOURS = 6;

/**
 * Sources whose parser has read new accounts since some partitions were pulled. A
 * succeeded or empty partition recorded under an older `detail.parser_version` (missing = 1) is due
 * again, so new fields fill in through ordinary, visible registry runs, newest first.
 */
export const REGISTRY_PARSER_VERSIONS: Record<string, number> = {
  [NCUA_FINANCIALS_SOURCE]: NCUA_PARSER_VERSION,
  [FRED_SOURCE]: FED_INDICATORS_PARSER_VERSION,
  [FDIC_UNIVERSE_SOURCE]: FDIC_UNIVERSE_PARSER_VERSION,
  [ENFORCEMENT_SOURCE]: ENFORCEMENT_MATCHER_VERSION,
  [STATE_ENFORCEMENT_SOURCE]: STATE_ENFORCEMENT_PARSER_VERSION,
  [STATE_REG_NEWS_SOURCE]: STATE_NEWS_PARSER_VERSION,
  [STATE_BILL_NEWS_SOURCE]: STATE_NEWS_PARSER_VERSION,
  [CENSUS_ACS_SOURCE]: CENSUS_ACS_PARSER_VERSION,
  [CFPB_SOURCE]: CFPB_PARSER_VERSION,
  [SEC_LINKS_SOURCE]: SEC_LINKS_PARSER_VERSION,
  [FFIEC_OVERDRAFT_SOURCE]: FFIEC_OVERDRAFT_PARSER_VERSION,
  [FFIEC_CALL_DETAIL_SOURCE]: FFIEC_CALL_DETAIL_PARSER_VERSION,
  [NCUA_EXTRAS_SOURCE]: NCUA_EXTRAS_PARSER_VERSION,
  [FDIC_HISTORY_SOURCE]: FDIC_HISTORY_PARSER_VERSION,
  ...Object.fromEntries(ECONOMY_DEFINITIONS.map((d) => [d.source, ECONOMY_PARSER_VERSION])),
  [ECONOMY_SOURCES.remittances]: REMITTANCE_PARSER_VERSION,
  [ECONOMY_SOURCES.branchTracts]: BRANCH_TRACT_PARSER_VERSION,
  [ECONOMY_SOURCES.bea]: BEA_PARSER_VERSION,
  ...Object.fromEntries(MARKET_GROWTH_DEFINITIONS.map((d) => [d.source, MARKET_GROWTH_PARSER_VERSION])),
  ...Object.fromEntries(SMALLBIZ_PAYMENTS_DEFINITIONS.map((d) => [d.source, SMALLBIZ_PAYMENTS_PARSER_VERSION])),
  ...Object.fromEntries(NATIONAL_CREDIT_DEFINITIONS.map((d) => [d.source, NATIONAL_CREDIT_PARSER_VERSION])),
  [USCOURTS_BANKRUPTCY_SOURCE]: USCOURTS_BANKRUPTCY_PARSER_VERSION,
  [USDA_FARM_SOURCE]: USDA_FARM_PARSER_VERSION,
  [BLS_OEWS_SOURCE]: BLS_OEWS_PARSER_VERSION,
  [BANK_MERGER_ORDERS_SOURCE]: BANK_MERGER_ORDERS_PARSER_VERSION,
  [MAKING_ENDS_MEET_SOURCE]: MAKING_ENDS_MEET_PARSER_VERSION,
  [PAYDAY_REPORTS_SOURCE]: PAYDAY_REPORTS_PARSER_VERSION,
  [URBAN_DEBT_SOURCE]: URBAN_DEBT_PARSER_VERSION,
  [ALLTHEPLACES_SOURCE]: ALLTHEPLACES_PARSER_VERSION,
  [GLEIF_SOURCE]: GLEIF_PARSER_VERSION,
  [STATE_NONBANK_LENDERS_SOURCE]: STATE_NONBANK_LENDERS_PARSER_VERSION,
  [STATE_DEPOSITORIES_SOURCE]: STATE_DEPOSITORIES_PARSER_VERSION,
  [SEC_MARKET_VALUE_SOURCE]: SEC_MARKET_VALUE_PARSER_VERSION,
  [INDUSTRY_EVENTS_SOURCE]: INDUSTRY_EVENTS_PARSER_VERSION,
  [PAYMENT_NETWORKS_SOURCE]: PAYMENT_NETWORKS_PARSER_VERSION,
  [HMDA_SOURCE]: HMDA_PARSER_VERSION,
  [HMDA_APOR_SOURCE]: HMDA_APOR_PARSER_VERSION,
  [DESIGNATION_LISTS_SOURCE]: DESIGNATION_LISTS_PARSER_VERSION,
  [CRA_SOURCE]: CRA_PARSER_VERSION,
  [FR_Y9C_SOURCE]: FR_Y9C_PARSER_VERSION,
  [NIC_STRUCTURE_SOURCE]: NIC_STRUCTURE_PARSER_VERSION,
  [UBPR_PEER_GROUPS_SOURCE]: UBPR_PEER_GROUPS_PARSER_VERSION,
  [CFPB_CARD_AGREEMENTS_SOURCE]: CFPB_CARD_AGREEMENTS_PARSER_VERSION,
  [BANK_ZELLE_SOURCE]: BANK_ZELLE_MATCHER_VERSION,
};

/**
 * True when a partition should run again now because the parser changed: a succeeded or empty
 * partition recorded by an older parser, or a claimed partition (still "scheduled" after a failed
 * run) claimed under an older parser. The second case means a code fix retries its failures on
 * the next tick instead of waiting out the claim's retry hours.
 */
export function isParserStale(
  source: string,
  status: string | null,
  parserVersion: number | null,
  claimedParserVersion: number | null = null,
): boolean {
  const current = REGISTRY_PARSER_VERSIONS[source];
  if (current === undefined) return false;
  if (status === "succeeded" || status === "empty") return (parserVersion ?? 1) < current;
  if (status === "scheduled") return (claimedParserVersion ?? 1) < current;
  if (status === "failed") return (parserVersion ?? claimedParserVersion ?? 1) < current;
  return false;
}

/**
 * A partition skipped because its free API key was not set is due as soon as that key is set,
 * instead of waiting out its normal re-check (a day for Census and BEA, a month for USDA farm
 * data, whose ERS half loads without a key while the NASS cash-rent half is skipped). A partition
 * the publisher rejected with a key stays put.
 */
export function isKeylessSkipNowKeyed(keylessSkip: boolean, key: string | undefined = process.env.CENSUS_API_KEY): boolean {
  return keylessSkip && Boolean(key?.trim());
}

/** The keyed sources whose keyless skips re-run once the key appears, and which key each waits for. */
export const KEYLESS_SKIP_KEYS = ["CENSUS_API_KEY", "BEA_API_KEY", "NASS_API_KEY"] as const;
export type KeylessSkipKey = (typeof KEYLESS_SKIP_KEYS)[number];

/** The keys, among those a keyless skip waits for, that are set now. */
export function keylessSkipKeysSet(env: Record<string, string | undefined> = process.env): Record<KeylessSkipKey, boolean> {
  // Not via isKeylessSkipNowKeyed: its default would read an unset key as CENSUS_API_KEY.
  const set = (key: KeylessSkipKey) => Boolean(env[key]?.trim());
  return { CENSUS_API_KEY: set("CENSUS_API_KEY"), BEA_API_KEY: set("BEA_API_KEY"), NASS_API_KEY: set("NASS_API_KEY") };
}

/**
 * SQL test, per key, for a partition recorded as skipped because that key was not set. Census and
 * BEA record the year as empty with a "No <KEY> set" reason; USDA farm records its ERS rows as a
 * success (or empty) with detail.nass.skipped_no_key.
 */
function keylessSkipSql(alias: "p" | "registry_ingest_partitions", keys: Record<KeylessSkipKey, boolean>) {
  const t = sql(alias);
  return sql`(
       (${keys.CENSUS_API_KEY}::boolean AND ${t}.status = 'empty' AND COALESCE(${t}.detail->>'reason', '') LIKE 'No CENSUS_API_KEY set%')
    OR (${keys.BEA_API_KEY}::boolean AND ${t}.status = 'empty' AND COALESCE(${t}.detail->>'reason', '') LIKE 'No BEA_API_KEY set%')
    OR (${keys.NASS_API_KEY}::boolean AND ${t}.source = 'usda-farm' AND ${t}.status IN ('succeeded', 'empty')
        AND COALESCE(${t}.detail->'nass'->>'skipped_no_key', 'false') = 'true')
  )`;
}

export interface RegistryPartitionCandidate {
  source: string;
  partitionKey: string;
}

export interface RegistryScheduleResult {
  scheduled: boolean;
  reason: "scheduled" | "active_run" | "nothing_due" | "schema_missing" | "claim_lost";
  source?: string;
  partitionKey?: string;
  runId?: number;
  reused?: boolean;
  /** Sources skipped because a table they write is over its size budget, with those tables. */
  heldForSize?: Array<{ source: string; tables: string[] }>;
}

export function backfillStart(env: string | undefined = process.env.REGISTRY_BACKFILL_FROM): Quarter {
  return (env && parseQuarterKey(env)) || DEFAULT_BACKFILL_FROM;
}

function years(from: number, to: number): string[] {
  const out: string[] = [];
  for (let year = to; year >= from; year -= 1) out.push(String(year));
  return out;
}

/**
 * Sources whose data terms are unconfirmed: the loader code stays, but no partition is scheduled
 * (nor offered to a manual run) until James confirms the terms. Their Hoovie contracts say `held`.
 * state-bill-news (Google News RSS) since 2026-10-18; World Bank remittance prices left on
 * 2026-10-18 (CC BY 4.0, DECISIONS.md "No non-commercial data").
 */
export const HELD_REGISTRY_SOURCES: ReadonlySet<string> = new Set([STATE_BILL_NEWS_SOURCE]);

/**
 * Each source's partitions, newest first. Fixed-partition sources come from REGISTRY_SOURCES.
 * `sizeHeld` names sources held because a table they write is over its size budget
 * (`src/lib/agents/hoovie/size-budgets.ts`); like held sources, they get no partitions.
 */
export function registryPartitionsBySource(
  now: Date,
  from: Quarter = backfillStart(),
  env: NodeJS.ProcessEnv = process.env,
  sizeHeld: ReadonlySet<string> = new Set(),
): Array<{ source: string; partitions: string[] }> {
  const quarters = (lagDays: number) =>
    quartersNewestFirst(from, latestPublishableQuarter(now, lagDays)).map(quarterKey);
  const dynamic: Record<string, string[]> = {
    [FDIC_FINANCIALS_SOURCE]: quarters(FDIC_FILING_LAG_DAYS),
    [NCUA_FINANCIALS_SOURCE]: quarters(NCUA_FILING_LAG_DAYS),
    [FFIEC_OVERDRAFT_SOURCE]: ffiecOverdraftPartitions(now),
    [FFIEC_CALL_DETAIL_SOURCE]: ffiecCallDetailPartitions(now),
    [NCUA_EXTRAS_SOURCE]: ncuaExtrasPartitions(now, compareQuarters(from, NCUA_EXTRAS_FIRST) > 0 ? from : NCUA_EXTRAS_FIRST),
    [FDIC_HISTORY_SOURCE]: fdicHistoryPartitions(now, Math.max(FDIC_HISTORY_FIRST_YEAR, from.year)),
    ...Object.fromEntries(ECONOMY_DEFINITIONS.filter((d) => !d.fixedPartition).map((d) => [d.source, d.partitions(now)])),
    ...Object.fromEntries(MARKET_GROWTH_DEFINITIONS.map((d) => [d.source, d.partitions(now)])),
    ...Object.fromEntries(SMALLBIZ_PAYMENTS_DEFINITIONS.filter((d) => !d.fixedPartition).map((d) => [d.source, d.partitions(now)])),
    ...Object.fromEntries(NATIONAL_CREDIT_DEFINITIONS.filter((d) => !d.fixedPartition).map((d) => [d.source, d.partitions(now)])),
    [INDUSTRY_EVENTS_SOURCE]: industryEventsPartitions(now),
    [PAYMENT_NETWORKS_SOURCE]: paymentNetworksPartitions(now),
    [HMDA_SOURCE]: hmdaPartitions(now, from.year),
    [DESIGNATION_LISTS_SOURCE]: designationListsPartitions(now),
    [CRA_SOURCE]: craPartitions(now, Math.max(CRA_LENDING_FIRST_YEAR, from.year)),
    [FR_Y9C_SOURCE]: frY9cPartitions(now, compareQuarters(from, FR_Y9C_FIRST) > 0 ? from : FR_Y9C_FIRST),
    [NIC_STRUCTURE_SOURCE]: nicStructurePartitions(),
    [UBPR_PEER_GROUPS_SOURCE]: ubprPeerGroupsPartitions(now, compareQuarters(from, UBPR_FIRST) > 0 ? from : UBPR_FIRST),
    [CFPB_CARD_AGREEMENTS_SOURCE]: cfpbCardAgreementsPartitions(now, from),
    [NCUA_BRANCHES_SOURCE]: ncuaBranchPartitions(now),
    [FDIC_SOD_SOURCE]: years(Math.max(SOD_FIRST_YEAR, from.year), latestSodYear(now)),
    [CENSUS_ACS_SOURCE]: censusAcsPartitions(now),
    [IRS_ZIP_INCOME_SOURCE]: irsZipIncomePartitions(now),
    [USCOURTS_BANKRUPTCY_SOURCE]: uscourtsBankruptcyPartitions(now),
    [USDA_FARM_SOURCE]: usdaFarmPartitions(now),
    [BLS_OEWS_SOURCE]: blsOewsPartitions(now),
    [BANK_MERGER_ORDERS_SOURCE]: bankMergerOrdersPartitions(now),
    [PAYDAY_REPORTS_SOURCE]: paydayReportsPartitions(now),
    [ALLTHEPLACES_SOURCE]: alltheplacesPartitions(now),
    [GLEIF_SOURCE]: gleifRegistryPartitions(now),
    [STATE_NONBANK_LENDERS_SOURCE]: stateNonbankLendersPartitions(now),
    [STATE_DEPOSITORIES_SOURCE]: stateDepositoriesPartitions(now),
    [SEC_MARKET_VALUE_SOURCE]: secMarketValuePartitions(now),
    [CFPB_SOURCE]: years(Math.max(CFPB_FIRST_YEAR, from.year), now.getUTCFullYear()),
    [SEC_FILINGS_SOURCE]: secBatchPartitions(),
    [BEIGE_BOOK_SOURCE]: beigeBookCandidates(now),
    // No key, no runs: state bills wait for OPEN_STATES_API_KEY rather than queue skips.
    // One partition; each run works through the states that are due (state-bills.ts).
    [STATE_BILLS_SOURCE]: env.OPEN_STATES_API_KEY?.trim() ? [STATE_BILLS_PARTITION] : [],
    [FEDERAL_BILLS_SOURCE]: env.CONGRESS_GOV_API_KEY?.trim() ? [FEDERAL_BILLS_PARTITION] : [],
  };
  return REGISTRY_SOURCES.map((definition) => ({
    source: definition.source,
    // Held sources schedule nothing: DECISIONS.md "No non-commercial data" (2026-10-17).
    // Size-held sources wait until Atlas measures their table back under budget, or a PR raises it.
    partitions: HELD_REGISTRY_SOURCES.has(definition.source) || sizeHeld.has(definition.source)
      ? []
      : definition.fixedPartition
        ? [definition.fixedPartition]
        : dynamic[definition.source] ?? [],
  }));
}

/**
 * Institution-roster sources that run ahead of every other source whenever one of their
 * partitions is due, so the closed-institution and merger checks (Atlas marks closed or merged
 * charters inactive from these) keep their cadence however many data sources are added. The
 * FDIC universe and NCUA 5300 syncs set `institution_sources.status`; ffiec-overdraft feeds the
 * overdraft income series; call-report-summaries rebuilds the readers' quarterly income right
 * after a call-report load makes it due. Every other source shares the remaining runs round-robin.
 */
export const PRIORITY_REGISTRY_SOURCES: readonly string[] = [
  FDIC_UNIVERSE_SOURCE,
  NCUA_FINANCIALS_SOURCE,
  FFIEC_OVERDRAFT_SOURCE,
  CALL_REPORT_SUMMARIES_SOURCE,
];

function roundRobin(lists: Array<{ source: string; partitions: string[] }>): RegistryPartitionCandidate[] {
  const longest = Math.max(0, ...lists.map((list) => list.partitions.length));
  const out: RegistryPartitionCandidate[] = [];
  for (let round = 0; round < longest; round += 1) {
    for (const list of lists) {
      const partitionKey = list.partitions[round];
      if (partitionKey) out.push({ source: list.source, partitionKey });
    }
  }
  return out;
}

/**
 * Every partition the registry should hold, in priority order: the roster sources in
 * PRIORITY_REGISTRY_SOURCES first, then round-robin across the rest (each source's newest
 * partition first), so one source's long backfill never starves the others. Within a round,
 * REGISTRY_SOURCES order applies, which puts identity syncs (FDIC universe, SEC links) ahead
 * of the data that depends on them.
 */
export function registryCandidates(
  now: Date,
  from: Quarter = backfillStart(),
  sizeHeld: ReadonlySet<string> = new Set(),
): RegistryPartitionCandidate[] {
  const lists = registryPartitionsBySource(now, from, process.env, sizeHeld);
  const priority = new Set(PRIORITY_REGISTRY_SOURCES);
  return [
    ...roundRobin(lists.filter((list) => priority.has(list.source))),
    ...roundRobin(lists.filter((list) => !priority.has(list.source))),
  ];
}

interface PartitionStateRow {
  source: string;
  partition_key: string;
  due: boolean;
}

/** First candidate that has never been attempted or whose next attempt is due. */
export function pickDueCandidate(
  candidates: RegistryPartitionCandidate[],
  rows: PartitionStateRow[],
): RegistryPartitionCandidate | null {
  const state = new Map(rows.map((row) => [`${row.source}:${row.partition_key}`, row.due]));
  for (const candidate of candidates) {
    const due = state.get(`${candidate.source}:${candidate.partitionKey}`);
    if (due === undefined || due) return candidate;
  }
  return null;
}

function isMissingSchemaError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return message.includes("registry_ingest_partitions") && message.includes("does not exist");
}

async function hasActiveRegistryRun(): Promise<boolean> {
  const [row] = await sql<{ active: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM agent_runs
       WHERE status IN ('queued', 'running', 'cancel_requested')
         AND params_json->>'source' = ${REGISTRY_RUN_SOURCE}
    ) AS active
  `;
  return Boolean(row?.active);
}

/** Atomically claim a partition so two ticks never schedule the same one. */
async function claimPartition(candidate: RegistryPartitionCandidate): Promise<boolean> {
  const parserVersion = REGISTRY_PARSER_VERSIONS[candidate.source] ?? 0;
  const keysSet = keylessSkipKeysSet();
  const rows = await sql`
    INSERT INTO registry_ingest_partitions (source, partition_key, status, attempts, next_attempt_after, detail)
    VALUES (${candidate.source}, ${candidate.partitionKey}, 'scheduled', 1,
            NOW() + (${CLAIM_RETRY_HOURS} * INTERVAL '1 hour'),
            jsonb_build_object('claimed_parser_version', ${parserVersion}::int))
    ON CONFLICT (source, partition_key) DO UPDATE SET
      status = 'scheduled',
      attempts = registry_ingest_partitions.attempts + 1,
      next_attempt_after = EXCLUDED.next_attempt_after,
      detail = COALESCE(registry_ingest_partitions.detail, '{}'::jsonb)
               || jsonb_build_object('claimed_parser_version', ${parserVersion}::int),
      updated_at = NOW()
    WHERE registry_ingest_partitions.next_attempt_after <= NOW()
       OR (registry_ingest_partitions.status IN ('succeeded', 'empty')
           AND COALESCE((registry_ingest_partitions.detail->>'parser_version')::int, 1) < ${parserVersion})
       OR (registry_ingest_partitions.status = 'scheduled'
           AND COALESCE((registry_ingest_partitions.detail->>'claimed_parser_version')::int, 1) < ${parserVersion})
       OR (registry_ingest_partitions.status = 'failed'
           AND COALESCE((registry_ingest_partitions.detail->>'parser_version')::int,
                        (registry_ingest_partitions.detail->>'claimed_parser_version')::int,1) < ${parserVersion})
       OR ${keylessSkipSql("registry_ingest_partitions", keysSet)}
    RETURNING id
  `;
  return [...rows].length > 0;
}

export interface RegistryLedgerAgent {
  agent: "hoovie" | "magellan";
  /** Why the run is written under Magellan's name instead of Hoovie's; absent when it is Hoovie's. */
  fallback?: string;
}

let hoovieRowCheck: Promise<boolean> | null = null;

/**
 * The name new registry runs are written under. agent_runs.agent_name references
 * agent_registry(agent_name), so a run written as `hoovie` before the row from
 * 20270110000061_hoovie_agent.sql exists would fail to insert. The row is read once per process and
 * the answer cached; while it is missing (or the read fails) runs keep Magellan's name, as before
 * #1865, and say so in `params_json.ledger_agent_fallback`. Every reader accepts both names. A
 * failed read is not cached, so the next run asks again.
 */
export async function registryLedgerAgent(): Promise<RegistryLedgerAgent> {
  hoovieRowCheck ??= sql<{ present: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM agent_registry WHERE agent_name = ${HOOVIE_AGENT}) AS present
  `.then((rows) => Boolean(rows[0]?.present));
  try {
    return (await hoovieRowCheck) ? { agent: HOOVIE_AGENT } : { agent: "magellan", fallback: "hoovie row missing" };
  } catch {
    hoovieRowCheck = null;
    return { agent: "magellan", fallback: "hoovie row check failed" };
  }
}

/** Test seam: forget the cached agent_registry read. */
export function resetRegistryLedgerAgentCache(): void {
  hoovieRowCheck = null;
}

export async function startRegistryRun(input: {
  source: string;
  partitionKey: string;
  triggeredBy: string;
  triggerSource?: AgentRunTriggerSource;
  dryRun?: boolean;
}) {
  const definition = REGISTRY_SOURCES.find((entry) => entry.source === input.source);
  if (!definition) throw new Error(`Unknown registry source: ${input.source}`);
  const label = input.partitionKey === definition.fixedPartition ? "" : ` ${input.partitionKey}`;
  // Hoovie owns public data (#1865). The idempotency key keeps its `magellan:registry:` prefix so
  // a run queued under Magellan's name before the switch is reused rather than started twice.
  const ledger = await registryLedgerAgent();
  const name = ledger.agent === HOOVIE_AGENT ? "Hoovie" : "Magellan";
  return startAgentRun({
    agent: ledger.agent,
    kind: input.dryRun ? "dry_run" : "workflow",
    title: `${name} registry: ${definition.title}${label}`,
    params: {
      source: REGISTRY_RUN_SOURCE,
      registry_source: input.source,
      partition_key: input.partitionKey,
      ...(ledger.fallback ? { ledger_agent_fallback: ledger.fallback } : {}),
    },
    triggeredBy: input.triggeredBy,
    triggerSource: input.triggerSource ?? "schedule",
    idempotencyKey: `magellan:registry:${input.source}:${input.partitionKey}${input.dryRun ? ":dry" : ""}`,
    steps: [
      {
        key: definition.stepKey,
        agent: ledger.agent,
        title: `${definition.title}${label}`,
        input: { partition_key: input.partitionKey },
      },
    ],
    summary: isProviderStep(definition.stepKey)
      ? `${name} registry run for ${input.source} ${input.partitionKey}. Provider step: budget-checked model calls, each logged with its cost.`
      : `${name} registry run for ${input.source} ${input.partitionKey}. Deterministic: published regulator data only, no provider calls.`,
  });
}

export async function scheduleDueRegistryRuns({
  now = new Date(),
  triggeredBy = "atlas.scheduler",
}: { now?: Date; triggeredBy?: string } = {}): Promise<RegistryScheduleResult> {
  try {
    if (await hasActiveRegistryRun()) return { scheduled: false, reason: "active_run" };

    // Atlas's latest measurement of the public-data tables. No measurement (or a failed read) holds nothing.
    const sizes = await readLatestTableSizes().catch(() => null);
    const held = sourcesHeldForSize(sizes);
    const heldForSize = held.size > 0 ? { heldForSize: [...held].map(([source, tables]) => ({ source, tables })) } : {};
    const candidates = registryCandidates(now, backfillStart(), new Set(held.keys()));
    const rows = await sql<(PartitionStateRow & { status: string | null; parser_version: string | null; claimed_parser_version: string | null; keyless_skip: boolean })[]>`
      SELECT p.source, p.partition_key, (p.next_attempt_after <= NOW()) AS due, p.status,
             p.detail->>'parser_version' AS parser_version,
             p.detail->>'claimed_parser_version' AS claimed_parser_version,
             ${keylessSkipSql("p", keylessSkipKeysSet())} AS keyless_skip
        FROM registry_ingest_partitions p
       WHERE p.source IN ${sql([...new Set(candidates.map((c) => c.source))])}
    `;
    const states = [...rows].map((row) => ({
      source: row.source,
      partition_key: row.partition_key,
      due: row.due || Boolean(row.keyless_skip) || isParserStale(
        row.source,
        row.status,
        row.parser_version === null ? null : Number(row.parser_version),
        row.claimed_parser_version === null ? null : Number(row.claimed_parser_version),
      ),
    }));
    const candidate = pickDueCandidate(candidates, states);
    if (!candidate) return { scheduled: false, reason: "nothing_due", ...heldForSize };
    if (!(await claimPartition(candidate))) return { scheduled: false, reason: "claim_lost", ...heldForSize };

    const started = await startRegistryRun({ ...candidate, triggeredBy });
    await sql`
      UPDATE registry_ingest_partitions
         SET agent_run_id = ${started.run.id}, updated_at = NOW()
       WHERE source = ${candidate.source} AND partition_key = ${candidate.partitionKey}
    `;
    return {
      scheduled: true,
      reason: "scheduled",
      source: candidate.source,
      partitionKey: candidate.partitionKey,
      runId: started.run.id,
      reused: started.reused,
      ...heldForSize,
    };
  } catch (error) {
    if (isMissingSchemaError(error)) return { scheduled: false, reason: "schema_missing" };
    throw error;
  }
}

/** The oldest queued registry run, if any (one is normally in flight at a time). */
export async function findQueuedRegistryRunId(): Promise<number | null> {
  const [row] = await sql<{ id: number }[]>`
    SELECT id FROM agent_runs
     WHERE status = 'queued' AND params_json->>'source' = ${REGISTRY_RUN_SOURCE}
     ORDER BY started_at ASC
     LIMIT 1
  `;
  return row ? Number(row.id) : null;
}

import type { RegistryDb } from "./partitions";
import { CENSUS_ACS_SOURCE, runRegistryCensusAcs } from "./census-acs";
import { CFPB_SOURCE, runRegistryCfpb } from "./cfpb";
import { IRS_ZIP_INCOME_SOURCE, runRegistryIrsZipIncome } from "./irs-zip-income";
import { FDIC_FINANCIALS_SOURCE, runRegistryFdicFinancials } from "./fdic-financials";
import { FFIEC_OVERDRAFT_SOURCE, runRegistryFfiecOverdraft } from "./ffiec-overdraft";
import { FDIC_SOD_SOURCE, runRegistryFdicSod } from "./fdic-sod";
import { FDIC_UNIVERSE_PARTITION, FDIC_UNIVERSE_SOURCE, runRegistryFdicUniverse } from "./fdic-universe";
import {
  BEIGE_BOOK_SOURCE,
  FOMC_MINUTES_PARTITION,
  FOMC_MINUTES_SOURCE,
  FRED_PARTITION,
  FRED_SOURCE,
  runRegistryBeigeBook,
  runRegistryFomcMinutes,
  runRegistryFred,
} from "./fed";
import { FED_PUBLICATIONS_PARTITION, FED_PUBLICATIONS_SOURCE, runRegistryFedPublications } from "./fed-publications";
import { REG_NEWS_PARTITION, REG_NEWS_SOURCE, runRegistryRegNews } from "./reg-news";
import { FEDERAL_REGISTER_PARTITION, FEDERAL_REGISTER_SOURCE, runRegistryFederalRegister } from "./federal-register";
import { STATE_BILLS_SOURCE, runRegistryStateBillsBatch } from "./state-bills";
import { FEDERAL_BILLS_SOURCE, runRegistryFederalBills } from "./federal-bills";
import { NCUA_FINANCIALS_SOURCE, runRegistryNcuaFinancials } from "./ncua-financials";
import {
  NCUA_BRANCH_GEOCODE_PARTITION,
  NCUA_BRANCH_GEOCODE_SOURCE,
  NCUA_BRANCHES_SOURCE,
  runRegistryNcuaBranchGeocode,
  runRegistryNcuaBranches,
} from "./ncua-branches";
import { SEC_FILINGS_SOURCE, SEC_LINKS_PARTITION, SEC_LINKS_SOURCE, runRegistrySecFilings, runRegistrySecLinks } from "./sec";
import { ENFORCEMENT_PARTITION, ENFORCEMENT_SOURCE, runRegistryEnforcement } from "./enforcement";
import { STATE_ENFORCEMENT_PARTITION, STATE_ENFORCEMENT_SOURCE, runRegistryStateEnforcement } from "./state-enforcement";
import { STATE_REGULATORS_PARTITION, STATE_REGULATORS_SOURCE, runRegistryStateRegulators } from "./state-regulators";
import { STATE_REG_NEWS_PARTITION, STATE_REG_NEWS_SOURCE, runRegistryStateRegNews } from "./state-reg-news";
import { STATE_BILL_NEWS_PARTITION, STATE_BILL_NEWS_SOURCE, runRegistryStateBillNews } from "./state-bill-news";
import { WIRE_RESEARCH_PARTITION, WIRE_RESEARCH_SOURCE, WIRE_RESEARCH_STEP_KEY, runRegistryWireResearch } from "./wire-research";

/**
 * Magellan regulatory registry: deterministic, run-ledger-visible ingestion of
 * published regulator data. Each source is one step key (`registry-<source>`)
 * that processes exactly one partition per step. One exception calls a model:
 * `registry-wire-research` (the Regulatory Wire's research notes) is a provider step,
 * listed in PROVIDER_STEP_KEYS and off until REG_WIRE_SUMMARIES_LIVE=true.
 */

export const REGISTRY_STEP_PREFIX = "registry-";

export interface RegistryStepInput {
  stepKey: string;
  runId: number;
  partitionKey?: string;
  dryRun: boolean;
  db?: RegistryDb;
}

export interface RegistryStepOutcome {
  status: "completed" | "skipped";
  summary: string;
  detail: Record<string, unknown>;
}

interface WorkerOutput {
  summary: string;
  detail: Record<string, unknown>;
  /** True when the worker could not load anything (e.g. a missing key); the step shows as skipped, not completed. */
  skipped?: boolean;
}

export interface RegistrySourceDefinition {
  source: string;
  stepKey: string;
  title: string;
  /** Sources with a single standing partition. */
  fixedPartition?: string;
  run: (input: RegistryStepInput & { partitionKey: string }) => Promise<WorkerOutput>;
}

const n = (value: number) => value.toLocaleString("en-US");
const dry = (flag: boolean) => (flag ? " (dry run)" : "");

export const REGISTRY_SOURCES: RegistrySourceDefinition[] = [
  {
    source: FDIC_UNIVERSE_SOURCE,
    stepKey: "registry-fdic-universe",
    title: "Sync the FDIC-insured bank universe",
    fixedPartition: FDIC_UNIVERSE_PARTITION,
    run: async (input) => {
      const r = await runRegistryFdicUniverse({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      return {
        summary: `Magellan synced ${n(r.activeInstitutions)} active FDIC institutions: ${r.updatedInstitutions} refreshed, ${r.insertedInstitutions} added, ${r.deactivatedInstitutions} marked closed or merged${dry(r.dryRun)}.`,
        detail: {
          source_url: r.sourceUrl,
          active_institutions: r.activeInstitutions,
          updated_institutions: r.updatedInstitutions,
          inserted_institutions: r.insertedInstitutions,
          deactivated_institutions: r.deactivatedInstitutions,
          missing_from_fdic: r.missingFromFdic,
          lookups_skipped: r.lookupsSkipped,
        },
      };
    },
  },
  {
    source: FDIC_FINANCIALS_SOURCE,
    stepKey: "registry-fdic-financials",
    title: "Pull FDIC call-report financials",
    run: async (input) => {
      const r = await runRegistryFdicFinancials({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return {
        summary: r.empty
          ? `FDIC has not published ${r.partitionKey} call reports yet; will check again.`
          : `Magellan pulled ${n(r.parsedRows)} FDIC call reports for ${r.partitionKey}: ${n(r.matchedRows)} matched, ${r.unmatchedRows} unmatched${dry(r.dryRun)}.`,
        detail: {
          report_date: r.reportDate,
          source_url: r.sourceUrl,
          fetched_rows: r.fetchedRows,
          parsed_rows: r.parsedRows,
          matched_rows: r.matchedRows,
          unmatched_rows: r.unmatchedRows,
          upserted_rows: r.upsertedRows,
          empty: r.empty,
        },
      };
    },
  },
  {
    source: NCUA_FINANCIALS_SOURCE,
    stepKey: "registry-ncua-financials",
    title: "Pull NCUA 5300 call-report financials",
    run: async (input) => {
      const r = await runRegistryNcuaFinancials({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return {
        summary: r.empty
          ? `NCUA has not published ${r.partitionKey} call reports yet; will check again.`
          : `Magellan pulled ${n(r.parsedRows)} NCUA call reports for ${r.partitionKey}: ${n(r.matchedRows)} matched, ${r.unmatchedRows} unmatched${r.universeSynced ? `; ${r.insertedInstitutions} credit unions added, ${r.deactivatedInstitutions} marked inactive` : ""}${dry(r.dryRun)}.`,
        detail: {
          report_date: r.reportDate,
          source_url: r.sourceUrl,
          credit_unions: r.creditUnions,
          parsed_rows: r.parsedRows,
          matched_rows: r.matchedRows,
          unmatched_rows: r.unmatchedRows,
          upserted_rows: r.upsertedRows,
          universe_synced: r.universeSynced,
          inserted_institutions: r.insertedInstitutions,
          refreshed_institutions: r.refreshedInstitutions,
          deactivated_institutions: r.deactivatedInstitutions,
          empty: r.empty,
        },
      };
    },
  },
  {
    source: FFIEC_OVERDRAFT_SOURCE,
    stepKey: "registry-ffiec-overdraft",
    title: "Pull bank overdraft and NSF income (FFIEC call report RIAD H032)",
    run: async (input) => {
      const r = await runRegistryFfiecOverdraft({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return {
        summary: r.empty
          ? `No bank overdraft income for ${r.partitionKey}: ${r.emptyReason}.`
          : `Magellan read overdraft and NSF income for ${n(r.filers)} banks for ${r.partitionKey}: ${n(r.matchedBanks)} matched, ${n(r.updatedRows)} call-report rows updated, ${n(r.quarterlyValues)} with a quarterly figure${dry(r.dryRun)}.`,
        detail: {
          report_date: r.reportDate,
          source_url: r.sourceUrl,
          file: r.fileName,
          filers: r.filers,
          matched_banks: r.matchedBanks,
          updated_rows: r.updatedRows,
          quarterly_values: r.quarterlyValues,
          empty: r.empty,
          empty_reason: r.emptyReason,
        },
      };
    },
  },
  {
    source: FDIC_SOD_SOURCE,
    stepKey: "registry-fdic-sod",
    title: "Pull FDIC Summary of Deposits branches",
    run: async (input) => {
      const r = await runRegistryFdicSod({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return {
        summary: r.empty
          ? `FDIC has not published ${r.partitionKey} branch deposits yet; will check again.`
          : `Magellan loaded ${n(r.branches)} branch offices for ${r.partitionKey} across ${n(r.institutions)} banks${dry(r.dryRun)}.`,
        detail: {
          source_url: r.sourceUrl,
          branches: r.branches,
          institutions: r.institutions,
          matched_branches: r.matchedBranches,
          upserted_branches: r.upsertedBranches,
          total_deposits_thousands: r.totalDeposits,
          empty: r.empty,
        },
      };
    },
  },
  {
    source: NCUA_BRANCHES_SOURCE,
    stepKey: "registry-ncua-branches",
    title: "Pull NCUA credit union branches",
    run: async (input) => {
      const r = await runRegistryNcuaBranches({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return {
        summary: r.empty
          ? `NCUA has not published ${r.partitionKey} call reports yet; will check again.`
          : `Magellan loaded ${n(r.branches)} credit union offices for ${r.partitionKey} across ${n(r.creditUnions)} credit unions; ${n(r.matchedBranches)} matched to an institution${dry(r.dryRun)}.`,
        detail: {
          source_url: r.sourceUrl,
          file: r.file,
          branches: r.branches,
          credit_unions: r.creditUnions,
          matched_branches: r.matchedBranches,
          upserted_branches: r.upsertedBranches,
          empty: r.empty,
        },
      };
    },
  },
  {
    source: NCUA_BRANCH_GEOCODE_SOURCE,
    stepKey: "registry-ncua-branch-geocode",
    title: "Map credit union branch addresses",
    fixedPartition: NCUA_BRANCH_GEOCODE_PARTITION,
    run: async (input) => {
      const r = await runRegistryNcuaBranchGeocode({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      return {
        summary:
          r.attempted === 0
            ? `No credit union branch addresses were waiting for map coordinates${dry(r.dryRun)}.`
            : `Magellan mapped ${n(r.matched)} of ${n(r.attempted)} credit union branch addresses with the US Census geocoder; ${n(r.remaining)} still to go${dry(r.dryRun)}.`,
        detail: { attempted: r.attempted, matched: r.matched, unmatched: r.unmatched, remaining: r.remaining },
      };
    },
  },
  {
    source: CFPB_SOURCE,
    stepKey: "registry-cfpb",
    title: "Pull CFPB consumer complaints",
    run: async (input) => {
      const r = await runRegistryCfpb({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return {
        summary: `Magellan matched ${r.acceptedCompanies} of ${n(r.companies)} CFPB companies for ${r.partitionKey} and recorded ${n(r.complaints)} complaints across ${r.institutions} institutions; ${r.reviewCompanies} names need review${dry(r.dryRun)}.`,
        detail: {
          source_url: r.sourceUrl,
          companies: r.companies,
          accepted_companies: r.acceptedCompanies,
          review_companies: r.reviewCompanies,
          institutions: r.institutions,
          complaints: r.complaints,
          rows_written: r.rowsWritten,
        },
      };
    },
  },
  {
    source: CENSUS_ACS_SOURCE,
    stepKey: "registry-census-acs",
    title: "Pull Census household income by state, county, ZIP and tract",
    run: async (input) => {
      const r = await runRegistryCensusAcs({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return {
        summary: r.skippedNoKey
          ? `Skipped the ${r.partitionKey} ACS 5-year estimates: Census requires CENSUS_API_KEY and none is set. Readers keep the latest vintage already loaded; will check again daily.`
          : r.empty
          ? `Census has not published the ${r.partitionKey} ACS 5-year estimates yet; will check again.`
          : `Magellan loaded ${r.partitionKey} ACS household income for ${n(r.counts.state)} states, ${n(r.counts.county)} counties, ${n(r.counts.zcta)} ZIP areas and ${n(r.counts.tract)} tracts; ${n(r.withIncome)} have a median income${dry(r.dryRun)}.`,
        detail: { year: r.year, counts: r.counts, with_income: r.withIncome, upserted_rows: r.upsertedRows, empty: r.empty, skipped_no_key: Boolean(r.skippedNoKey) },
        skipped: Boolean(r.skippedNoKey),
      };
    },
  },
  {
    source: IRS_ZIP_INCOME_SOURCE,
    stepKey: "registry-irs-zip-income",
    title: "Pull IRS income and interest by ZIP code",
    run: async (input) => {
      const r = await runRegistryIrsZipIncome({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return {
        summary: r.empty
          ? `The IRS has not published tax year ${r.partitionKey} ZIP income yet; will check again.`
          : `Magellan loaded tax year ${r.partitionKey} IRS income for ${n(r.zips)} ZIP codes; ${n(r.withInterest)} report taxable interest${dry(r.dryRun)}.`,
        detail: { tax_year: r.taxYear, zips: r.zips, with_interest: r.withInterest, upserted_rows: r.upsertedRows, empty: r.empty },
      };
    },
  },
  {
    source: SEC_LINKS_SOURCE,
    stepKey: "registry-sec-links",
    title: "Link SEC filers to bank holding companies",
    fixedPartition: SEC_LINKS_PARTITION,
    run: async (input) => {
      const r = await runRegistrySecLinks({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      return {
        summary: `Magellan matched ${r.bankFilers} SEC bank filers (${r.acceptedLinks} linked, ${r.reviewLinks} for review) and tagged ${r.institutionsTagged} institutions${dry(r.dryRun)}.`,
        detail: {
          source_url: r.sourceUrl,
          listed_filers: r.listedFilers,
          name_matches: r.nameMatches,
          bank_filers: r.bankFilers,
          accepted_links: r.acceptedLinks,
          review_links: r.reviewLinks,
          institutions_tagged: r.institutionsTagged,
        },
      };
    },
  },
  {
    source: SEC_FILINGS_SOURCE,
    stepKey: "registry-sec-filings",
    title: "Pull SEC filings and XBRL financials",
    run: async (input) => {
      const r = await runRegistrySecFilings({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return {
        summary: `Magellan refreshed ${r.ciks} SEC filers (${r.partitionKey}): ${n(r.filings)} filings, ${n(r.factQuarters)} quarters of holding-company financials${dry(r.dryRun)}.`,
        detail: { ciks: r.ciks, filings: r.filings, fact_quarters: r.factQuarters },
      };
    },
  },
  {
    source: BEIGE_BOOK_SOURCE,
    stepKey: "registry-beige-book",
    title: "Pull the Federal Reserve Beige Book",
    run: async (input) => {
      const r = await runRegistryBeigeBook({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return {
        summary: r.empty
          ? `No Beige Book was released in ${r.partitionKey}.`
          : `Magellan loaded the ${r.releaseDate ?? r.partitionKey} Beige Book: ${r.sections} sections from ${r.pages} reports${dry(r.dryRun)}.`,
        detail: { release_date: r.releaseDate, pages: r.pages, sections: r.sections, empty: r.empty },
      };
    },
  },
  {
    source: FRED_SOURCE,
    stepKey: "registry-fred",
    title: "Refresh FRED economic indicators",
    fixedPartition: FRED_PARTITION,
    run: async (input) => {
      const r = await runRegistryFred({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      return {
        summary: `Magellan refreshed ${r.refreshedSeries} of ${r.series} FRED series (${n(r.observations)} observations)${dry(r.dryRun)}.`,
        detail: { series: r.series, refreshed_series: r.refreshedSeries, missing_series: r.missingSeries, observations: r.observations },
      };
    },
  },
  {
    source: FOMC_MINUTES_SOURCE,
    stepKey: "registry-fomc-minutes",
    title: "Pull FOMC minutes",
    fixedPartition: FOMC_MINUTES_PARTITION,
    run: async (input) => {
      const r = await runRegistryFomcMinutes({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      const short = r.tooShort.length > 0 ? ` ${r.tooShort.length} page(s) did not parse: ${r.tooShort.join(", ")}.` : "";
      return {
        summary: `Magellan found ${r.linked} FOMC minutes on the Fed calendar, stored ${r.stored} new ones; ${r.remaining} still to pull${dry(r.dryRun)}.${short}`,
        detail: {
          linked: r.linked,
          already_stored: r.alreadyStored,
          fetched: r.fetched,
          stored: r.stored,
          too_short: r.tooShort,
          remaining: r.remaining,
        },
      };
    },
  },
  {
    source: FED_PUBLICATIONS_SOURCE,
    stepKey: "registry-fed-publications",
    title: "Pull regional Fed publications",
    fixedPartition: FED_PUBLICATIONS_PARTITION,
    run: async (input) => {
      const r = await runRegistryFedPublications({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      const missing = r.banksWithoutItems.length > 0 ? ` No items from: ${r.banksWithoutItems.join(", ")}.` : "";
      return {
        summary: `Magellan read ${r.fetched} regional Fed publications from ${12 - r.banksWithoutItems.length} of 12 Reserve Banks and stored ${r.inserted} new ones${dry(r.dryRun)}.${missing}`,
        detail: {
          index_reachable: r.indexReachable,
          fetched: r.fetched,
          inserted: r.inserted,
          by_bank: r.byBank,
          banks_without_items: r.banksWithoutItems,
          failed_feeds: r.failedFeeds,
        },
      };
    },
  },
  {
    source: REG_NEWS_SOURCE,
    stepKey: "registry-reg-news",
    title: "Pull regulator press releases",
    fixedPartition: REG_NEWS_PARTITION,
    run: async (input) => {
      const r = await runRegistryRegNews({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      const failed = r.failedFeeds.length > 0 ? ` ${r.failedFeeds.length} feed(s) failed: ${r.failedFeeds.join("; ")}.` : "";
      return {
        summary: `Magellan read ${r.fetched} regulator press releases and stored ${r.inserted} new ones${dry(r.dryRun)}.${failed}`,
        detail: { fetched: r.fetched, inserted: r.inserted, failed_feeds: r.failedFeeds },
      };
    },
  },
  {
    source: FEDERAL_REGISTER_SOURCE,
    stepKey: "registry-federal-register",
    title: "Pull the banking regulators' proposed and final rules",
    fixedPartition: FEDERAL_REGISTER_PARTITION,
    run: async (input) => {
      const r = await runRegistryFederalRegister({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      const mode = r.shadow ? " (shadow mode: nothing stored)" : "";
      return {
        summary: `Magellan read ${r.fetched} Federal Register rules since ${r.since}: ${r.stages.comment_open} open for comment, ${r.stages.final_not_yet_effective} final but not yet in effect; stored ${r.stored}${mode}${dry(r.dryRun)}.`,
        detail: {
          since: r.since,
          fetched: r.fetched,
          reported_total: r.reported_total,
          pages: r.pages,
          stored: r.stored,
          stages: r.stages,
          agencies: r.agencies,
          fee_related: r.fee_related,
          shadow: r.shadow,
        },
      };
    },
  },
  {
    source: FEDERAL_BILLS_SOURCE,
    stepKey: "registry-federal-bills",
    title: "Pull federal bank fee bills",
    run: async (input) => {
      const r = await runRegistryFederalBills({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      const mode = r.shadow ? " (shadow mode: nothing stored)" : "";
      return {
        summary: r.missingKey
          ? "Skipped federal bills: CONGRESS_GOV_API_KEY is not set."
          : `Magellan scanned ${n(r.scanned)} bills in the ${r.congress}th Congress and found ${r.fetched} bank fee bills (${r.stages.passed_chamber + r.stages.passed_legislature} passed a chamber, ${r.stages.signed} signed); stored ${r.stored}${mode}${dry(r.dryRun)}.`,
        detail: {
          congress: r.congress,
          missing_key: r.missingKey,
          scanned: r.scanned,
          reported_total: r.reported_total,
          requests: r.requests,
          fetched: r.fetched,
          stored: r.stored,
          stages: r.stages,
          shadow: r.shadow,
        },
      };
    },
  },
  {
    source: STATE_BILLS_SOURCE,
    stepKey: "registry-state-bills",
    title: "Pull state bank fee bills",
    run: async (input) => {
      const r = await runRegistryStateBillsBatch({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      const mode = r.shadow ? " (shadow mode: nothing stored)" : "";
      const failed = r.failedStates.length > 0 ? ` Failed: ${r.failedStates.join(", ")}.` : "";
      const limited = r.rateLimited ? " Open States rate limited the run; the rest stay due." : "";
      return {
        summary: r.missingKey
          ? "Skipped state bills: OPEN_STATES_API_KEY is not set."
          : `Magellan read ${r.states.length} states (${r.states.join(", ") || "none due"}) and found ${r.fetched} bank fee bills (${r.stages.passed_chamber + r.stages.passed_legislature} passed a chamber, ${r.stages.signed} signed); stored ${r.stored}${mode}; ${r.remaining} states still due${dry(r.dryRun)}.${failed}${limited}`,
        detail: {
          missing_key: r.missingKey,
          states: r.states,
          failed_states: r.failedStates,
          rate_limited: r.rateLimited,
          remaining: r.remaining,
          fetched: r.fetched,
          stored: r.stored,
          stages: r.stages,
          shadow: r.shadow,
        },
      };
    },
  },
  {
    source: STATE_REG_NEWS_SOURCE,
    stepKey: "registry-state-reg-news",
    title: "Pull state banking regulators' news",
    fixedPartition: STATE_REG_NEWS_PARTITION,
    run: async (input) => {
      const r = await runRegistryStateRegNews({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      const mode = r.shadow ? " (shadow mode: nothing stored)" : "";
      const by = (m: string) => r.agencies.filter((a) => a.mode === m);
      const read = by("feed").length + by("page").length;
      const missed = [...by("none"), ...by("failed")].map((a) => a.state);
      return {
        summary: `Magellan read news from ${read} of ${r.agencies.length} state regulator sites (${by("feed").length} by feed, ${by("page").length} by news page): ${n(r.fetched)} items, ${n(r.feeRelated)} about fees; stored ${r.stored}${mode}${dry(r.dryRun)}.${missed.length > 0 ? ` Nothing read for ${[...new Set(missed)].join(", ")}.` : ""}`,
        detail: {
          fetched: r.fetched,
          fee_related: r.feeRelated,
          stored: r.stored,
          shadow: r.shadow,
          read,
          agencies: r.agencies.length,
          by_mode: Object.fromEntries(["feed", "page", "none", "failed", "no_website", "not_reached"].map((m) => [m, by(m).map((a) => a.state)])),
        },
      };
    },
  },
  {
    source: STATE_BILL_NEWS_SOURCE,
    stepKey: "registry-state-bill-news",
    title: "Pull news about state bank fee bills",
    fixedPartition: STATE_BILL_NEWS_PARTITION,
    run: async (input) => {
      const r = await runRegistryStateBillNews({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      const mode = r.shadow ? " (shadow mode: nothing stored)" : "";
      const billsWithNews = r.queries.filter((q) => q.kind === "bill" && q.items > 0).length;
      const statesWithNews = r.queries.filter((q) => q.kind === "state" && q.items > 0).map((q) => q.state);
      const limited = r.rateLimited ? " Google News limited the run; the rest wait for tomorrow." : "";
      return {
        summary: `Magellan searched news for ${r.bills} state fee bills (${billsWithNews} with coverage) and fee legislation in ${r.states.length} states (${statesWithNews.length} with stories): ${n(r.fetched)} stories; stored ${r.stored}${mode}${dry(r.dryRun)}.${limited}`,
        detail: {
          bills: r.bills,
          bills_with_news: billsWithNews,
          states: r.states,
          states_with_news: statesWithNews,
          fetched: r.fetched,
          stored: r.stored,
          not_reached: r.notReached,
          rate_limited: r.rateLimited,
          shadow: r.shadow,
        },
      };
    },
  },
  {
    source: STATE_REGULATORS_SOURCE,
    stepKey: "registry-state-regulators",
    title: "Sync the state regulator registry",
    fixedPartition: STATE_REGULATORS_PARTITION,
    run: async (input) => {
      const r = await runRegistryStateRegulators({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      return {
        summary: `Magellan synced ${r.agencies} state regulators and tagged ${r.creditUnionsTagged} credit unions with their chartering agency${dry(r.dryRun)}.`,
        detail: { agencies: r.agencies, credit_unions_tagged: r.creditUnionsTagged },
      };
    },
  },
  {
    source: ENFORCEMENT_SOURCE,
    stepKey: "registry-enforcement",
    title: "Pull OCC and Federal Reserve enforcement actions",
    fixedPartition: ENFORCEMENT_PARTITION,
    run: async (input) => {
      const r = await runRegistryEnforcement({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      const { OCC, FRB } = r.byAgency;
      const failed = r.failed.length > 0 ? ` Failed: ${r.failed.join("; ")}.` : "";
      return {
        summary: `Magellan read ${n(OCC.actions)} OCC and ${n(FRB.actions)} Federal Reserve enforcement actions against institutions: ${n(OCC.matched + FRB.matched)} matched to a bank and ${n(OCC.holdingCompany + FRB.holdingCompany)} to a holding company${dry(r.dryRun)}.${failed}`,
        detail: { by_agency: r.byAgency, upserted: r.upserted, failed: r.failed },
      };
    },
  },
  {
    source: STATE_ENFORCEMENT_SOURCE,
    stepKey: "registry-state-enforcement",
    title: "Pull state banking departments' enforcement orders",
    fixedPartition: STATE_ENFORCEMENT_PARTITION,
    run: async (input) => {
      const r = await runRegistryStateEnforcement({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      const read = r.byState.filter((s) => s.pages > 0);
      const orders = r.byState.reduce((sum, s) => sum + s.orders, 0);
      const matched = r.byState.reduce((sum, s) => sum + s.matched, 0);
      const unread = r.byState.filter((s) => s.pages === 0).map((s) => s.state);
      return {
        summary: `Magellan read ${n(read.length)} state banking departments and found ${n(orders)} orders against banks, ${n(matched)} matched to a bank${dry(r.dryRun)}.${unread.length > 0 ? ` No page read for ${unread.join(", ")}.` : ""}`,
        detail: { by_state: r.byState, upserted: r.upserted },
      };
    },
  },
  {
    source: WIRE_RESEARCH_SOURCE,
    stepKey: WIRE_RESEARCH_STEP_KEY,
    title: "Write research notes for the Regulatory Wire",
    fixedPartition: WIRE_RESEARCH_PARTITION,
    run: async (input) => {
      const r = await runRegistryWireResearch({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      if (r.schemaMissing) {
        return {
          summary: "Skipped Regulatory Wire research notes: the reg_wire_research table is not in the database yet.",
          detail: { schema_missing: true, shadow: r.shadow },
          skipped: true,
        };
      }
      const usd = (r.costMicrousd / 1_000_000).toFixed(4);
      const would = r.items.filter((i) => i.outcome === "would_summarise").length;
      const notReached = r.items.filter((i) => i.outcome === "not_reached").length;
      const stopped = r.budgetStopped ? ` A budget cap or the provider stop ended the step: ${r.budgetReason}.` : "";
      return {
        summary: r.shadow || r.dryRun
          ? `Magellan picked ${r.selected} wire items without a research note and could read ${would} of them; ${r.unreadable} unreadable (${r.shadow ? "shadow mode: no model call, nothing stored" : "dry run"}).`
          : `Magellan wrote ${r.written} Regulatory Wire research notes with ${r.model} from ${r.selected} items: ${r.unreadable} unreadable, ${r.failed} failed, ${notReached} left for the next run; ${r.datesDropped} dates dropped because the source text does not state them; estimated cost $${usd}.${stopped}`,
        detail: {
          shadow: r.shadow,
          model: r.model,
          selected: r.selected,
          would_summarise: would,
          written: r.written,
          unreadable: r.unreadable,
          failed: r.failed,
          not_reached: notReached,
          dates_dropped: r.datesDropped,
          budget_stopped: r.budgetStopped,
          budget_reason: r.budgetReason,
          cost_microusd: r.costMicrousd,
          items: r.items,
        },
      };
    },
  },
];

export const REGISTRY_STEP_KEYS = REGISTRY_SOURCES.map((entry) => entry.stepKey);

export function isRegistryStepKey(stepKey: string): boolean {
  return stepKey.startsWith(REGISTRY_STEP_PREFIX);
}

export function registrySourceForStep(stepKey: string): RegistrySourceDefinition | undefined {
  return REGISTRY_SOURCES.find((entry) => entry.stepKey === stepKey);
}

export async function runRegistryStep(input: RegistryStepInput): Promise<RegistryStepOutcome> {
  const definition = registrySourceForStep(input.stepKey);
  if (!definition) {
    return { status: "skipped", summary: `No registry worker for ${input.stepKey} yet.`, detail: { missing_worker: input.stepKey } };
  }
  const partitionKey = input.partitionKey ?? definition.fixedPartition;
  if (!partitionKey) {
    return {
      status: "skipped",
      summary: `${definition.title} had no partition to process.`,
      detail: { registry_source: definition.source, missing_partition: true },
    };
  }
  const output = await definition.run({ ...input, partitionKey });
  return {
    status: output.skipped ? "skipped" : "completed",
    summary: output.summary,
    detail: { registry_source: definition.source, partition_key: partitionKey, dry_run: input.dryRun, ...output.detail },
  };
}

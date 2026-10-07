import type { RegistryDb } from "./partitions";
import { CFPB_SOURCE, runRegistryCfpb } from "./cfpb";
import { FDIC_FINANCIALS_SOURCE, runRegistryFdicFinancials } from "./fdic-financials";
import { FDIC_SOD_SOURCE, runRegistryFdicSod } from "./fdic-sod";
import { FDIC_UNIVERSE_PARTITION, FDIC_UNIVERSE_SOURCE, runRegistryFdicUniverse } from "./fdic-universe";
import { BEIGE_BOOK_SOURCE, FRED_PARTITION, FRED_SOURCE, runRegistryBeigeBook, runRegistryFred } from "./fed";
import { REG_NEWS_PARTITION, REG_NEWS_SOURCE, runRegistryRegNews } from "./reg-news";
import { FEDERAL_REGISTER_PARTITION, FEDERAL_REGISTER_SOURCE, runRegistryFederalRegister } from "./federal-register";
import { NCUA_FINANCIALS_SOURCE, runRegistryNcuaFinancials } from "./ncua-financials";
import {
  NCUA_BRANCH_GEOCODE_PARTITION,
  NCUA_BRANCH_GEOCODE_SOURCE,
  NCUA_BRANCHES_SOURCE,
  runRegistryNcuaBranchGeocode,
  runRegistryNcuaBranches,
} from "./ncua-branches";
import { SEC_FILINGS_SOURCE, SEC_LINKS_PARTITION, SEC_LINKS_SOURCE, runRegistrySecFilings, runRegistrySecLinks } from "./sec";
import { STATE_REGULATORS_PARTITION, STATE_REGULATORS_SOURCE, runRegistryStateRegulators } from "./state-regulators";

/**
 * Magellan regulatory registry: deterministic, run-ledger-visible ingestion of
 * published regulator data. Each source is one step key (`registry-<source>`)
 * that processes exactly one partition per step.
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
          fee_related: r.fee_related,
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
    status: "completed",
    summary: output.summary,
    detail: { registry_source: definition.source, partition_key: partitionKey, dry_run: input.dryRun, ...output.detail },
  };
}

import type { RegistryDb } from "./partitions";
import { FDIC_FINANCIALS_SOURCE, runRegistryFdicFinancials } from "./fdic-financials";
import { FDIC_UNIVERSE_PARTITION, FDIC_UNIVERSE_SOURCE, runRegistryFdicUniverse } from "./fdic-universe";

/**
 * Magellan regulatory registry: deterministic, run-ledger-visible ingestion of
 * published regulator data. Each registry source is one step key
 * (`registry-<source>`) that processes exactly one partition per step.
 */

export const REGISTRY_STEP_PREFIX = "registry-";

export interface RegistrySourceDefinition {
  source: string;
  stepKey: string;
  title: string;
}

export const REGISTRY_SOURCES: RegistrySourceDefinition[] = [
  { source: FDIC_UNIVERSE_SOURCE, stepKey: "registry-fdic-universe", title: "Sync the FDIC-insured bank universe" },
  { source: FDIC_FINANCIALS_SOURCE, stepKey: "registry-fdic-financials", title: "Pull FDIC call-report financials" },
];

export function isRegistryStepKey(stepKey: string): boolean {
  return stepKey.startsWith(REGISTRY_STEP_PREFIX);
}

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

export async function runRegistryStep(input: RegistryStepInput): Promise<RegistryStepOutcome> {
  switch (input.stepKey) {
    case "registry-fdic-universe": {
      const result = await runRegistryFdicUniverse({ runId: input.runId, dryRun: input.dryRun, db: input.db });
      return {
        status: "completed",
        summary: `Magellan synced ${result.activeInstitutions.toLocaleString("en-US")} active FDIC institutions: ${result.updatedInstitutions} refreshed, ${result.insertedInstitutions} added, ${result.deactivatedInstitutions} marked closed or merged${result.dryRun ? " (dry run)" : ""}.`,
        detail: {
          registry_source: result.source,
          partition_key: FDIC_UNIVERSE_PARTITION,
          source_url: result.sourceUrl,
          active_institutions: result.activeInstitutions,
          updated_institutions: result.updatedInstitutions,
          inserted_institutions: result.insertedInstitutions,
          deactivated_institutions: result.deactivatedInstitutions,
          missing_from_fdic: result.missingFromFdic,
          lookups_skipped: result.lookupsSkipped,
          dry_run: result.dryRun,
        },
      };
    }
    case "registry-fdic-financials": {
      if (!input.partitionKey) {
        return {
          status: "skipped",
          summary: "FDIC financials step had no quarter partition to pull.",
          detail: { registry_source: FDIC_FINANCIALS_SOURCE, missing_partition: true },
        };
      }
      const result = await runRegistryFdicFinancials({
        runId: input.runId,
        partitionKey: input.partitionKey,
        dryRun: input.dryRun,
        db: input.db,
      });
      return {
        status: "completed",
        summary: result.empty
          ? `FDIC has not published ${result.partitionKey} call reports yet; will check again.`
          : `Magellan pulled ${result.parsedRows.toLocaleString("en-US")} FDIC call reports for ${result.partitionKey}: ${result.matchedRows.toLocaleString("en-US")} matched, ${result.unmatchedRows} unmatched${result.dryRun ? " (dry run)" : ""}.`,
        detail: {
          registry_source: result.source,
          partition_key: result.partitionKey,
          report_date: result.reportDate,
          source_url: result.sourceUrl,
          fetched_rows: result.fetchedRows,
          parsed_rows: result.parsedRows,
          matched_rows: result.matchedRows,
          unmatched_rows: result.unmatchedRows,
          upserted_rows: result.upsertedRows,
          empty: result.empty,
          dry_run: result.dryRun,
        },
      };
    }
    default:
      return {
        status: "skipped",
        summary: `No registry worker for ${input.stepKey} yet.`,
        detail: { missing_worker: input.stepKey },
      };
  }
}

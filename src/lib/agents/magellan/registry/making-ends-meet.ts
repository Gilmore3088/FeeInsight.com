import { sql } from "@/lib/data-store/connection";
import { checkAreaStats, dedupeAreaStats, type AreaStatChecks } from "@/lib/regulatory/economy";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { fetchMakingEndsMeet, type MemFetch } from "@/lib/regulatory/making-ends-meet";
import { upsertAreaStats } from "./economy";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step for the CFPB Making Ends Meet public-use file, into area_statistics.
 *
 * The public-use file carries every wave in one release (or one file per wave, all listed on the
 * same page), so the step has one standing partition, `current`: a run re-reads every wave and
 * upserts (idempotent). The partition detail says which questions were found per wave, whether the
 * overdraft-fee question is in the public file, the survey weight used, and every file tried.
 */

export const MAKING_ENDS_MEET_SOURCE = "cfpb-making-ends-meet";
export const MAKING_ENDS_MEET_PARSER_VERSION = 1;
export const MAKING_ENDS_MEET_PARTITION = "current";
export const MAKING_ENDS_MEET_TITLE = "Pull the CFPB Making Ends Meet survey public-use file";
export const MAKING_ENDS_MEET_LABEL = "CFPB Making Ends Meet survey";

/** New waves come out about once a year; a monthly re-read is plenty. */
const REFRESH_HOURS = 24 * 30;
const EMPTY_RETRY_HOURS = 24 * 7;

/** One standing partition whatever the date; `now` is taken for the shared partitions signature. */
export function makingEndsMeetPartitions(now: Date): string[] {
  void now;
  return [MAKING_ENDS_MEET_PARTITION];
}

export interface RegistryMakingEndsMeetOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  env?: Record<string, string | undefined>;
}

export interface RegistryMakingEndsMeetResult {
  source: string;
  partitionKey: string;
  sourceUrl: string | null;
  rows: number;
  writtenRows: number;
  missingFields: string[];
  unexpectedFields: string[];
  checks: AreaStatChecks | null;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
  summary: string;
  detail: Record<string, unknown>;
}

const n = (value: number) => value.toLocaleString("en-US");

/** The report, compacted for the partition detail: which questions per wave, with counts. */
export function questionsByWave(fetched: MemFetch): Record<string, Record<string, string | null>> {
  const out: Record<string, Record<string, string | null>> = {};
  for (const w of fetched.report?.waves ?? []) {
    out[w.wave] = Object.fromEntries(
      Object.entries(w.measures).map(([key, uses]) => [
        key,
        uses === null
          ? null
          : uses.map((u) => `${u.variable}: ${u.usable ? `${u.respondents} respondents` : `not used (${u.unclassified.join("; ") || "no answers"})`}`).join(" | "),
      ]),
    );
  }
  return out;
}

export async function runRegistryMakingEndsMeet(options: RegistryMakingEndsMeetOptions): Promise<RegistryMakingEndsMeetResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const fetched = await fetchMakingEndsMeet(options.env ?? process.env, options.fetchOptions);
  const report = fetched.report;
  const base = {
    source: MAKING_ENDS_MEET_SOURCE,
    partitionKey: options.partitionKey,
    sourceUrl: fetched.url,
    missingFields: fetched.missingFields,
    unexpectedFields: fetched.unexpectedFields,
    dryRun,
  };
  const reportDetail = {
    parser_version: MAKING_ENDS_MEET_PARSER_VERSION,
    missing_fields: fetched.missingFields,
    unexpected_fields: fetched.unexpectedFields,
    skipped_records: fetched.skipped,
    overdraft_question_in_public_file: report ? report.overdraftQuestionInPublicFile : null,
    overdraft_wording: report?.overdraftWording ?? null,
    weight_variable: report?.weight.variable ?? null,
    weight_wording: report?.weight.wording ?? null,
    weight_candidates: report?.weight.candidates.map((c) => c.variable) ?? [],
    wave_variable: report?.waveVariable ?? null,
    wave_candidates: report?.waveCandidates.map((c) => c.variable) ?? [],
    dimensions: report?.dimensions
      ? Object.fromEntries(Object.entries(report.dimensions).map(([k, d]) => [k, { variable: d.variable, candidates: d.candidates.map((c) => c.variable), problem: d.problem }]))
      : null,
    questions: report?.questions.map((q) => ({ key: q.key, matched: q.matched.map((c) => `${c.variable}: ${c.text.slice(0, 160)}`), chosen: q.chosen, ambiguous: q.ambiguous })) ?? [],
    questions_by_wave: questionsByWave(fetched),
    rows_by_wave: Object.fromEntries((report?.waves ?? []).map((w) => [w.wave, { rows: w.rows, rows_without_weight: w.rowsWithoutWeight }])),
    codebook_format: report?.codebookFormat ?? null,
    codebook_entries: report?.codebookEntries ?? 0,
    unexpected_counts: report ? { codebook_only: report.unexpected.codebookOnly, undocumented_columns: report.unexpected.undocumented } : null,
    transport: fetched.transport,
  };

  if (fetched.rows.length === 0) {
    const reason = fetched.emptyReason ?? `${MAKING_ENDS_MEET_LABEL} returned no values`;
    const detail = { ...reportDetail, reason };
    if (!dryRun) {
      await recordRegistryPartition(db, {
        source: MAKING_ENDS_MEET_SOURCE,
        partitionKey: options.partitionKey,
        status: "empty",
        rowCount: 0,
        sourceUrl: fetched.url,
        runId: options.runId ?? null,
        nextAttemptAfterHours: EMPTY_RETRY_HOURS,
        detail,
      });
    }
    return {
      ...base,
      rows: 0,
      writtenRows: 0,
      checks: null,
      empty: true,
      emptyReason: reason,
      summary: `${MAKING_ENDS_MEET_LABEL} ${options.partitionKey}: nothing loaded. ${reason}${dryRun ? " (dry run)" : ""}.`,
      detail: { ...detail, empty_reason: reason },
    };
  }

  const checks = checkAreaStats(fetched.rows);
  const rows = dedupeAreaStats(fetched.rows);
  const waves = [...new Set(rows.map((r) => r.period))].sort().reverse();
  const detail: Record<string, unknown> = {
    ...reportDetail,
    rows: rows.length,
    waves,
    series: [...new Set(rows.map((r) => r.series_key))].length,
    blank_by_series: checks.blankBySeries,
    duplicate_keys: checks.duplicateKeys,
    duplicate_examples: checks.duplicateExamples,
    flagged_values: checks.flagged,
  };
  const od = report?.overdraftQuestionInPublicFile ? "overdraft question found" : "overdraft question NOT in the public file";
  const gaps = fetched.missingFields.length > 0 ? `; not found: ${fetched.missingFields.slice(0, 4).join(", ")}${fetched.missingFields.length > 4 ? ` and ${fetched.missingFields.length - 4} more` : ""}` : "";
  if (dryRun) {
    return { ...base, rows: rows.length, writtenRows: 0, checks, empty: false, emptyReason: null, summary: `${MAKING_ENDS_MEET_LABEL}: read ${n(rows.length)} values for waves ${waves.join(", ")}; ${od}${gaps} (dry run).`, detail };
  }
  const written = await upsertAreaStats(db, MAKING_ENDS_MEET_SOURCE, rows, fetched.url, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: MAKING_ENDS_MEET_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rows.length,
    insertedCount: written,
    sourceUrl: fetched.url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: REFRESH_HOURS,
    detail,
  });
  return {
    ...base,
    rows: rows.length,
    writtenRows: written,
    checks,
    empty: false,
    emptyReason: null,
    summary: `Magellan loaded ${MAKING_ENDS_MEET_LABEL}: ${n(written)} values for waves ${waves.join(", ")}; ${od}${gaps}.`,
    detail: { ...detail, written_rows: written },
  };
}

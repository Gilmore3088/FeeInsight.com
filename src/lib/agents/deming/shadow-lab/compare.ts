import { createHash } from "node:crypto";
import { scoreRun, type VariantMetrics } from "./metrics";
import { stripTiming } from "./run-case";
import { STAGE_IDS, type CaseTrace, type ScenarioId, type ShadowCase, type StageId } from "./types";
import type { ExperimentConfig } from "./variants";

export const SHADOW_LAB_VERSION = 1;

export interface VariantRun {
  traces: CaseTrace[];
  /** Further runs of the same variant (same order, reversed order) for the stability check. */
  repeats: CaseTrace[][];
  providerCalls: number;
}

export interface CompareInput {
  cases: ShadowCase[];
  versions: Record<string, string>;
  fixtures: { path: string; sha256: string }[];
  notReplayable: readonly { issue: string; failure: string; reason: string }[];
  current: VariantRun;
  experimental: VariantRun & { config: ExperimentConfig };
}

type StageTiming = Record<StageId, { totalMs: number; p50Ms: number }>;

export interface Comparison {
  labVersion: number;
  versions: Record<string, string>;
  fixtures: { path: string; sha256: string }[];
  scenarios: { id: ScenarioId; cases: number }[];
  notReplayable: readonly { issue: string; failure: string; reason: string }[];
  variants: { current: VariantMetrics; experimental: VariantMetrics & { config: ExperimentConfig } };
  caseDiffs: { caseKey: string; current: string[]; experimental: string[] }[];
  stability: { runs: number; identical: boolean; sha256: string };
  timing: Record<"current" | "experimental", StageTiming>;
}

/** JSON with object keys sorted, so equal content is equal text. */
function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const tracesHash = (traces: CaseTrace[]) => sha256(sortedJson(traces.map(stripTiming)));

function publishedSummary(trace: CaseTrace | undefined): string[] {
  return (trace?.published ?? []).map((fee) => `${fee.canonicalFeeKey}:${fee.amountCents}:${fee.frequency ?? "-"}`).sort();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function timing(traces: CaseTrace[]): StageTiming {
  return Object.fromEntries(
    STAGE_IDS.map((stage) => {
      const values = traces.map((trace) => trace.durationsMs[stage]);
      return [stage, { totalMs: values.reduce((sum, value) => sum + value, 0), p50Ms: median(values) }];
    }),
  ) as StageTiming;
}

export function compareRuns(input: CompareInput): Comparison {
  const { cases, current, experimental } = input;
  const experimentalByKey = new Map(experimental.traces.map((trace) => [trace.caseKey, trace]));
  const caseDiffs = current.traces.flatMap((trace) => {
    const before = publishedSummary(trace);
    const after = publishedSummary(experimentalByKey.get(trace.caseKey));
    return sortedJson(before) === sortedJson(after) ? [] : [{ caseKey: trace.caseKey, current: before, experimental: after }];
  });
  const stable = (run: VariantRun) => run.repeats.every((repeat) => tracesHash(repeat) === tracesHash(run.traces));
  const scenarios = [...new Set(cases.map((c) => c.scenario))].sort().map((id) => ({ id, cases: cases.filter((c) => c.scenario === id).length }));
  return {
    labVersion: SHADOW_LAB_VERSION,
    versions: input.versions,
    fixtures: input.fixtures,
    scenarios,
    notReplayable: input.notReplayable,
    variants: {
      current: scoreRun(cases, current.traces, current.providerCalls),
      experimental: { ...scoreRun(cases, experimental.traces, experimental.providerCalls), config: experimental.config },
    },
    caseDiffs,
    stability: {
      runs: 1 + current.repeats.length,
      identical: stable(current) && stable(experimental),
      sha256: sha256(tracesHash(current.traces) + tracesHash(experimental.traces)),
    },
    timing: { current: timing(current.traces), experimental: timing(experimental.traces) },
  };
}

/** The comparison without its timings: equal for equal inputs and code. */
export function stableJson(comparison: Comparison): string {
  const rest: Partial<Comparison> = { ...comparison };
  delete rest.timing;
  return sortedJson(rest);
}

/** The full comparison, timings included, with keys sorted. */
export function comparisonJson(comparison: Comparison): string {
  return `${JSON.stringify(JSON.parse(sortedJson(comparison)), null, 2)}\n`;
}

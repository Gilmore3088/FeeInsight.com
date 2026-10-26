export const RESEARCH_VERSION = 1;
export const RESEARCH_EDITION = "research_v1";
export const RESEARCH_MODULES = ["market", "performance", "fees"] as const;
export type ResearchModule = typeof RESEARCH_MODULES[number];
export type ResearchCharter = "bank" | "credit_union";

export interface ResearchRequest {
  scope: "national" | "footprint";
  institutionId: number | null;
  cadence: "quarterly" | "monthly";
  modules: ResearchModule[];
  evidencePolicy: "verified-only";
}

export interface ResearchMetric {
  key: string;
  module: ResearchModule;
  label: string;
  unit: "people" | "dollars" | "percent" | "branches" | "ratio" | "establishments" | "loans" | "jobs";
  aggregation: "sum" | "median" | "ratio";
  definition: string;
  sources: string[];
  maxAgeDays: number;
}

export interface ResearchCell {
  key: string;
  cohort: string;
  value: number | null;
  period: string | null;
  eligible: number;
  observed: number;
  status: "available" | "limited" | "unavailable";
  note: string;
  sourceUrls: string[];
  releaseStatus?: "first_edition" | "new_period" | "same_period" | "snapshot_refresh";
}

export interface ResearchFootprint {
  institutionId: number;
  name: string;
  charter: ResearchCharter;
  vintage: string | null;
  counties: string[];
  branches: number;
  matchedBranches: number;
  unmatchedBranches: number;
  status: "available" | "partial" | "unavailable";
}

export interface ResearchAuditRow {
  source: string;
  publisher: string;
  licence: string;
  tables: string[];
  latestPeriod: string | null;
  lastSuccessAt: string | null;
  loadedPartitions: number;
  status: "ready" | "blocked" | "unmeasured" | "stale";
  reason: string;
}

export interface ResearchSnapshot {
  version: number;
  metricVersion: number;
  feeStatsVersion: number;
  capturedAt: string;
  request: ResearchRequest;
  footprint: ResearchFootprint | null;
  cells: ResearchCell[];
  audit: ResearchAuditRow[];
  limitations: string[];
  inputHash: string;
  snapshotHash: string;
  pipelineCommit: string;
}

export function parseResearchRequest(value: unknown): ResearchRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Research request must be an object.");
  const v = value as Record<string, unknown>;
  if (v.scope !== "national" && v.scope !== "footprint") throw new Error("Choose national or footprint research.");
  if (v.cadence !== "quarterly" && v.cadence !== "monthly") throw new Error("Choose quarterly or monthly research.");
  if (v.evidencePolicy !== undefined && v.evidencePolicy !== "verified-only") throw new Error("Research benchmarks require verified-only evidence.");
  const id = v.institutionId;
  if (v.scope === "footprint" && !(typeof id === "number" && Number.isSafeInteger(id) && id > 0)) throw new Error("Footprint research requires a canonical institution ID.");
  const modules = v.modules ?? [...RESEARCH_MODULES];
  if (!Array.isArray(modules) || !modules.length || modules.some(m => !RESEARCH_MODULES.includes(m))) throw new Error("Choose valid research modules.");
  return {
    scope: v.scope, institutionId: v.scope === "footprint" ? id as number : null,
    cadence: v.cadence, modules: RESEARCH_MODULES.filter(m => modules.includes(m)), evidencePolicy: "verified-only",
  };
}

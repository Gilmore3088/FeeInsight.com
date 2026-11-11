export const SCORECARD_REPOSITORY: string;
export interface ScorecardMetric {
  status: string;
  value: number | null;
  numerator?: number;
  denominator?: number;
  reason?: string;
  scope?: string;
  runs?: number;
  samples?: number;
  unknownRuns?: number;
  eligibleChanges?: number;
  meaning?: string;
}
export interface ScorecardChange {
  prNumber: number;
  headSha: string | null;
  merged: boolean | null;
  mergedAt: string | null;
  riskTier: string | null;
  contractKey: string | null;
  contractExecutionStatus: 'CURRENT' | 'HISTORICAL_ONLY' | null;
  currentCodeVerified: boolean;
  contractSha256: string | null;
  historicalContractSha256: string | null;
  policySha256: string | null;
  review: { status: string; latencyHours: number | null; blockers: string[] };
  ownerAuthorization: { required: boolean | null; status: string; decidedAt: string | null };
  proof: { status: string; blockers: string[]; currentCodeVerified?: boolean; contractKey?: string | null; completedBeforeMerge?: boolean };
  ci: { status: string; runId?: number; runAttempt?: number };
  problems: string[];
}
export interface ScorecardCollection {
  schemaVersion: number;
  repository: string;
  observedAt: string;
  provenance: { kind: string };
  scope: { prNumbers: number[]; selection: string; trustedMainSha: string; policySha256: string; enforcementEnabled: boolean };
  changes: ScorecardChange[];
  exclusions: Array<{ prNumber: number; reason: string }>;
  metrics: Record<string, ScorecardMetric>;
  problems: string[];
}
export function collectScorecard(options: { prNumbers: number[]; token: string; now?: Date; fetchImpl?: typeof fetch }): Promise<ScorecardCollection>;
export function isScorecardEvidence(value: unknown): boolean;
export function assessScorecard(value: unknown, options?: { now?: Date }): {
  status: string;
  scope: ScorecardCollection['scope'] | null;
  changes: ScorecardChange[];
  exclusions: ScorecardCollection['exclusions'];
  metrics: Record<string, ScorecardMetric>;
  problems: string[];
};
export function renderScorecard(value: unknown, options?: { now?: Date }): string;

export interface ReviewPolicy {
  headSha: string;
  contractSha256: string;
  policySha256: string;
  allowedReviewers?: string[];
  ownerLogins?: string[];
  now?: Date;
}
export interface OperationalPolicy {
  headSha: string;
  deployedSha: string;
  environment: string;
  cohortId: string;
  scorerVersion: number;
  protocol: number;
  minScoredInstitutions: number;
  minExpectedFees: number;
  minPredictedFees: number;
  minPrecision: number;
  minRecall: number;
  maxUnscoredInstitutions?: number;
  observationDays?: number;
  maxSampleGapHours?: number;
  replayChangeKeys: string[];
}
export function assessReviewEvidence(snapshot: unknown, policy: ReviewPolicy): {
  status: string;
  ownerSignoff: { actor: string; id: number; url: string; decidedAt: string; eventKind: 'review' | 'comment' } | null;
  independentReviewers: Array<{ actor: string; id: number; url: string }>;
  findings: unknown[];
  blockers: string[];
};
export function assessOperationalEvidence(runtime: unknown, policy: OperationalPolicy, options?: { github?: unknown; now?: Date }): {
  status: string;
  deployment: { id: number; sha: string; environment: string; deployedAt: string } | null;
  observation: { requiredDays: number; sampleDays: number; sampleCount: number };
  blockers: string[];
};
export function collectRuntimeEvidence(options: {
  origin?: string;
  adminCookie: string;
  deployedSha: string;
  since: string;
  until: string;
  changeKeys?: string[];
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<unknown>;
export function assessRetention(options: { createdAt: string; expiresAt?: string | null; expired?: boolean; now?: Date; retentionDays?: number }): { status: string; expiresAt: string | null };
export function calculateEngineeringMetrics(records: readonly unknown[]): {
  status: string;
  eligibleRiskTiers: string[];
  mergedChanges: number;
  missingRiskTier: number;
  verificationCoverage: number | null;
  recurrenceCount: number;
  regressionCount: number;
  reviewLatencyMedianHours: number | null;
  productionVerificationLagMedianHours: number | null;
  ciOverheadMedian: number | null;
  ciOverheadTarget: number;
  ciOverheadSampleCount: number;
  falseBlockRate: number | null;
  problems: string[];
};
export function renderEvidenceSummary(input: { proof?: unknown; ci?: unknown; review?: unknown; operational?: unknown; metrics?: unknown; artifacts?: unknown[] }): string;

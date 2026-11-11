import type { ContractRevision } from './contract-registry.mjs';
import type { classifyChange, routeSkillRequirements } from './contract.mjs';
import type { assessCollectedProof } from './proof.mjs';
import type { assessReviewEvidence, assessOperationalEvidence } from './evidence.mjs';
import type { assessScorecard } from './scorecard.mjs';

export interface CliCiEvidence {
  status: 'PASSED' | 'BLOCKED';
  association: unknown;
  runId: number | null;
  runAttempt: number | null;
  workflowId: number | null;
  runHeadSha: string | null;
  actualCheckoutSha: null;
  checkoutRef: string;
  trustedWorkflow: unknown;
  run: unknown;
  jobs: unknown[];
  artifacts: unknown[];
  problems: string[];
}
export interface CliPrepareResult {
  prNumber: number;
  contractKey: ContractRevision['key'];
  executionStatus: ContractRevision['executionStatus'];
  headSha: string;
  baseSha: string;
  contractPath: string;
  contractSha256: string;
  actualRisk: ReturnType<typeof classifyChange>;
  actualChangedPaths: string[];
}
export interface CliAuditResult {
  schemaVersion: number;
  repository: string;
  prNumber: number;
  contractKey: ContractRevision['key'];
  executionStatus: ContractRevision['executionStatus'];
  currentCodeVerified: boolean;
  headSha: string;
  contractPath: string;
  contractSha256: string;
  policySha256: string;
  actualRisk: ReturnType<typeof classifyChange>;
  actualChangedPaths: string[];
  status: 'CODE_VERIFIED' | 'BLOCKED';
  enforcementEnabled: boolean;
  proof: ReturnType<typeof assessCollectedProof>;
  ci: CliCiEvidence;
  review: ReturnType<typeof assessReviewEvidence>;
  operational: ReturnType<typeof assessOperationalEvidence> | { status: 'PRODUCTION_UNVERIFIED'; blockers: string[] };
  authorization: 'SEPARATE_OWNER_AUTHORIZATION_REQUIRED' | 'EXISTING_REPOSITORY_MERGE_RULES_APPLY';
}
export interface CliValidationResult {
  status: 'PLAN_TRACEABLE' | 'BLOCKED';
  requirements: number;
  problems: string[];
  contracts: string[];
  contractRevisions: Array<Pick<ContractRevision, 'key' | 'contractId' | 'path' | 'executionStatus'> & { currentCodeVerified: false }>;
  operationalStatus: 'PRODUCTION_UNVERIFIED';
  enforcementEnabled: boolean;
}
export interface CliInventoryResult {
  schemaVersion: number;
  measuredAt: string;
  availableSkills: string[];
  routes: Array<ReturnType<typeof routeSkillRequirements> & { path: string }>;
  controls: { enforcement: boolean; paidProviderActivated: false; newProductionTables: false };
  ciBaseline: unknown;
}
export type CliRunResolution = { resolved: false; reason: string }
  | { resolved: true; prNumber: number; headSha: string; contractKey: ContractRevision['key']; executionStatus: ContractRevision['executionStatus'] };
export type CliScorecardResult = ReturnType<typeof assessScorecard>
  | { schemaVersion: number; status: 'BLOCKED'; provenance: 'COLLECTION_FAILED'; prNumbers: number[]; metrics: null; problems: string[] };
export interface CliResults {
  audit: CliAuditResult;
  prepare: CliPrepareResult;
  validate: CliValidationResult;
  inventory: CliInventoryResult;
  'resolve-run': CliRunResolution;
  scorecard: CliScorecardResult;
}
export function main<Command extends keyof CliResults>(args: readonly [Command, ...string[]], root?: string): Promise<CliResults[Command]>;
export function main(args?: readonly string[], root?: string): Promise<CliResults[keyof CliResults]>;

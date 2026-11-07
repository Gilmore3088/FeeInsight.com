export type RiskTier = 'R0' | 'R1' | 'R2' | 'R3';
export type StructuralProofAssessment = {
  status: 'BLOCKED' | 'STRUCTURALLY_VALID_UNTRUSTED';
  problems: string[];
};

export function contractDigest(rawText: string): string;
export function changedPaths(files: unknown): { paths: string[]; problems: string[] };
export function isPolicySensitive(path: unknown): boolean;
export function classifyPath(path: unknown): RiskTier;
export function classifyChange(paths: unknown): {
  risk_tier: RiskTier;
  policy_sensitive: boolean;
  reasons: string[];
};
export function routeSkills(paths: unknown): string[];
export function routeSkillRequirements(paths: unknown, availableSkills?: unknown): {
  required_skills: string[];
  available_skills: string[];
  unavailable_skills: string[];
};
export function validateContract(contract: unknown): { ok: boolean; errors: string[] };
export function assessProofBundle(contract: unknown, bundle: unknown, currentHeadSha: unknown, expectedContractSha256: unknown): StructuralProofAssessment;
export function assessProofPair(contract: unknown, pair: unknown, currentHeadSha: unknown, expectedContractSha256: unknown): StructuralProofAssessment;
export function assessProductionEvidence(evidence: unknown): {
  status: 'PRODUCTION_UNVERIFIED' | 'OPERATIONAL_EVIDENCE_CANDIDATE_UNTRUSTED';
  blockers: string[];
};
export function mayUseDocsOnlyFastPath(changedPaths: unknown): boolean;

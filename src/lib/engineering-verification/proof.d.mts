export interface ProofCollection {
  schemaVersion: number;
  repository: string;
  prNumber: number;
  headSha: string;
  observedAt: string;
  provenance: { kind: 'test-transport-untrusted' | 'authenticated-github-proof-artifact' };
  run: Record<string, unknown> | null;
  artifact: Record<string, unknown> | null;
  receipt: Record<string, unknown> | null;
  validation: { status: 'PASSED' | 'BLOCKED'; problems: string[] };
  status: 'VERIFIED' | 'BLOCKED';
}
export function collectProofEvidence(options: {
  github: unknown;
  contract: unknown;
  contractRaw: string;
  token: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<ProofCollection>;
export function isCollectedProof(value: unknown): boolean;
export function assessCollectedProof(snapshot: unknown, options?: { now?: Date }): {
  status: 'VERIFIED' | 'BLOCKED';
  blockers: string[];
  runId: number | null;
  runAttempt: number | null;
  artifactId: number | null;
  artifactDigest: string | null;
};

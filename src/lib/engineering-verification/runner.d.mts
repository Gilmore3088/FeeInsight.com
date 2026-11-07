import type { PilotOutcome } from './pilot.mjs';
export function validateSnapshotEntries(tree: unknown): number;
export function sandboxArguments(options: { name: string; image: string; source: string; harness: string; toolchain: string }): string[];
export function classifyExecution(result: { status: number | null; stdout: string; stderr: string; signal?: string | null; error?: { code?: string; message?: string } }, adapterId?: string): {
  execution_exit_code: number | null; failure_kind: string; outcomes: PilotOutcome[]; error?: string; values?: unknown;
};
export function frozenIdentities(root: string, contract: unknown): Record<string, string>;
export function runPilot(options: { repositoryRoot: string; headSha: string; outputDirectory: string; contractNumber?: string; artifactUrl?: string }): { assessment: { status: string; problems: string[] }; head_sha: string; duration_ms: number };

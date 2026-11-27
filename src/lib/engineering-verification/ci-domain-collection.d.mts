export const COLLECTION_LIMITS: Readonly<{ wholeMs: 45000; workMs: 26000; cleanupEndMs: 44000;
  artifactBytes: 2097152; receiptReserve: 65536; cleanupReserve: 262144; teardownMs: 350;
  memoryBytes: 805306368; pids: 128; cpus: 1; tmpfsBytes: 33554432; maxCases: 32 }>;
export const READER_IMAGE: string;
export function canonicalPath(path: string, leafMayBeMissing?: boolean): string;
export function readBoundedRegular(path: string, maximum?: number): Buffer;
export class CollectionClock {
  constructor(started?: number);
  started: number;
  interruptions: string[];
  active: Set<() => void>;
  end(phase: string): number;
  require(phase: string, headroom?: number): void;
  interrupt(signal: string): void;
}
export interface ArtifactIdentity { path: string; bytes: number; sha256: string }
export type WriteOperation = (fd: number, bytes: Uint8Array, offset: number, length: number) => number;
export function writeAll(fd: number, bytes: Uint8Array, options?: {
  writer?: WriteOperation; deadlineMs?: number; onProgress?: (bytes: number) => void;
}): number;
export function probeOwnedProcessGroup(pid: number, probe?: (pid: number, signal: number) => void): { absent: boolean; error: string | null };
export interface CaptureRecord {
  label: string; argv: string[]; phase: string; startedOffsetMs: number; absoluteDeadlineOffsetMs: number;
  inputBytes: number; status: number | null; signal: string | null; pid: number | null; processReaped: boolean;
  endedOffsetMs: number; milliseconds: number; timeout: boolean; overflow: boolean; interrupted: boolean;
  spawnError: string | null; ioErrors: string[]; streamsComplete: boolean; inputBytesWritten: number;
  inputComplete: boolean; stdout: ArtifactIdentity & { retained: boolean }; stderr: ArtifactIdentity & { retained: boolean };
  processGroupAbsent: boolean; processGroupProbeError: string | null; processGroupCleanupRequired: boolean;
  processGroupProbes: { offsetMs: number; absent: boolean; error: string | null }[];
}
export class BoundedArtifactStore {
  constructor(output: string, clock?: CollectionClock, writer?: WriteOperation);
  output: string; written: number; writer: WriteOperation; clock: CollectionClock;
  entries: Map<string, ArtifactIdentity & { retained: boolean }>;
  available(phase?: string): number;
  path(name: string): string;
  stream(name: string): number;
  append(name: string, fd: number, bytes: Uint8Array, phase?: string): void;
  close(name: string, fd: number): ArtifactIdentity & { retained: boolean };
  save(name: string, bytes: Uint8Array, phase?: string, mode?: number): ArtifactIdentity & { retained: boolean };
  inventory(): ArtifactIdentity[];
}
export interface CaptureOptions { phase?: 'work' | 'cleanup'; payload?: Uint8Array; milliseconds?: number; limit?: number }
export interface CaptureResult { record: CaptureRecord; stdout: Buffer; stderr: Buffer }
export type CaptureFunction = (label: string, argv: string[], options?: CaptureOptions) => Promise<CaptureResult>;
export class BoundedCapturer {
  constructor(store: BoundedArtifactStore, clock: CollectionClock);
  store: BoundedArtifactStore; clock: CollectionClock; records: CaptureRecord[]; cwd?: string;
  capture(label: string, argv: string[], options?: CaptureOptions): Promise<CaptureResult>;
}
export function processCaptureComplete(record: unknown, status?: number): boolean;
export interface NativeIdentity { containerId: string | null; name: string; owner: string; batchId: string }
export function admitBuiltinNone(value: unknown): boolean;
export function ownedNativeContainer(native: unknown, identity: NativeIdentity): boolean;
export function admitNativeConfiguration(native: unknown, image: unknown, identity: NativeIdentity, harness: string, builtin: unknown): boolean;
export function validateChildBatchRecord(value: unknown, caseIds: string[], routes: { method: string; url: string }[]): unknown[];
export function cleanupOwnedContainer(capture: CaptureFunction, identity: NativeIdentity, allocated: boolean): Promise<{
  containerId: string | null; absence: { name: boolean; owner: boolean; id: boolean | null }; errors: string[]; verified: boolean;
}>;
export interface BatchManifest {
  schemaVersion: 1; kind: 'CI_DOMAIN_NATIVE_BATCH_OBSERVATIONS'; adapter: 'engineering.ci-domains.v1';
  batchId: string; caseIds: string[];
  source: { commit: string; path: string; blob: string; sha256: string; bytes: number };
  harness: { childSha256: string; probeSha256: string; stimulusSha256: string; parentOracleSha256: string;
    collectionSha256: string; parserSha256: string; parentOracleMounted: false };
  input: ArtifactIdentity; output: ArtifactIdentity; stderr: ArtifactIdentity; image: string;
  nativeContainer: { name: string; id: string; owner: string; batchId: string };
  nativeConfigurationAdmitted: boolean; sourceBookendMatches: boolean; controlBookendMatches: boolean; cleanupVerified: boolean;
  cleanupObservations: { name: boolean; owner: boolean; id: boolean | null; harnessAbsent: boolean };
  executionExitCode: number | null; collectionStatus: 'COMPLETE_UNASSESSED' | 'SETUP_BLOCKED'; primaryErrors: string[];
  cleanupErrors: string[]; interruptionSignals: string[]; processes: CaptureRecord[];
  absoluteDeadlines: { workMs: 26000; cleanupEndMs: 44000; wholeMs: 45000 }; secondsBeforeFinalization: number;
  registered: false; currentCodeVerified: false; limitations: string[]; artifacts: ArtifactIdentity[];
  aggregateAccounting: { capBytes: number; retainedBeforeReceiptBytes: number; receiptBytes: number; totalRetainedBytes: number;
    cumulativeWrittenIncludingRemovedHarnessBytes: number; includesSourcesCollectorMetadataAndReceipt: true };
}
export interface BatchExpectations {
  sourceRef?: string; sourceSha256?: string; batchId?: string; caseIds?: string[];
  childSha256?: string; collectionSha256?: string; parserSha256?: string;
}
export function validateBatchManifest(value: unknown, expected?: BatchExpectations): BatchManifest;
export function collectCiDomainBatch(options: {
  repositoryRoot: string; sourceRef: string; expectedSourceSha256: string; outputDirectory: string;
  batchId: string; caseIds: string[]; request: { adapter: string; cases: { id: string; text: string }[] };
  image?: string; harnessSources: Record<'child.mjs' | 'ci-domain-probe.mjs' | 'ci-domain-stimulus-v2.json', Uint8Array>;
  parentOracleBytes: Uint8Array;
}): Promise<{
  collectionStatus: 'COMPLETE_UNASSESSED' | 'SETUP_BLOCKED'; execution_exit_code: number | null;
  stdout: Buffer; stderr: Buffer; manifest: BatchManifest; receiptPath: string; receiptSha256: string;
  source: { commit: string; blob: string | null; sha256: string }; cleanupVerified: boolean;
  runtime: { node?: string; arch?: string; platform?: string } | null; error?: string;
}>;
export function finalizeBatchReceipt(store: BoundedArtifactStore, manifest: object, clock: CollectionClock): { bytes: Buffer; target: string };

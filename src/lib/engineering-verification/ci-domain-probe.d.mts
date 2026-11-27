export interface OfflineCall { repository: string; prNumber: number; token: string;
  requiredChecks: string[]; includeDeployments: false; now: string; }
export interface OfflineResponse { status: number; json: unknown; }
export interface OfflineRoute { method: 'GET' | 'POST'; url: string; response: OfflineResponse;
  repeat: 'same'; requestJson?: unknown; }
export interface OfflineMutation { routeUrl: string; responseRead: 'all' | 2;
  jsonPath?: string; set?: unknown; replaceResponse?: OfflineResponse; }
export interface OfflineStimulus { schemaVersion: 2; call: OfflineCall; routes: OfflineRoute[];
  cases: Array<{ id: string; mutations: OfflineMutation[] }>; }
export interface RequestObservation { method: string; url: string; readIndex: number; }
export interface WrapperObservation { executionComplete: boolean; setupErrors: string[];
  requestCount: number; membershipReadCount: number; requests: RequestObservation[]; subjectError?: string; }
export type OfflineFetch = (url: string, options: Record<string, unknown>) => Promise<{
  status: number; ok: boolean; json(): Promise<unknown>;
}>;
export interface ReaderModule { collectGithubEvidence(options: Omit<OfflineCall, 'now'> & {
  now: Date; fetchImpl: OfflineFetch;
}): Promise<unknown>; isGithubEvidence(snapshot: unknown): boolean; }
export const PROBE_LIMITS: Readonly<{ inputBytes: number; outputBytes: number; cases: number;
  routes: number; requestsPerCase: number; setupErrors: number; deadlineMs: number; }>;
export function admitStimulus(input: unknown): OfflineStimulus;
export function createOfflineApi(routes: OfflineRoute[], mutations: OfflineMutation[],
  options?: { maxRequests?: number }): Readonly<{ fetchImpl: OfflineFetch;
    reject(code: string): never; observation(): WrapperObservation }>;
export function observeReader(reader: ReaderModule, admitted: OfflineStimulus): Promise<Array<{
  schemaVersion: number; caseId: string; observation: null | Record<string, unknown>; wrapper: WrapperObservation;
}>>;

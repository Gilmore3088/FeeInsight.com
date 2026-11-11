export type Limits = {
  operationDeadlineMs: number; wholeCaseDeadlineMs: number; maxHeaderBytes: number;
  maxBodyBytesPerDirection: number; maxWireBytesPerDirection: number;
  maxConcurrentClientFlows: number; maxConcurrentUpstreamLegs: number;
  maxConcurrentPhysicalDataConnections: number; maxProxyDataSocketHandles: number;
  maxAllFixtureDataSocketHandles: number; maxEligibleHeldRequests: number;
  maxControlOperations: number; maxSemanticEventsPerCase: number;
  maxProxyQueuedBytesPerDirection: number; maxAllRawArtifactBytesPerCase: number;
};
export type Address = { host: '127.0.0.1'; port: number };
export type ControlReceipt = { ok: boolean; ordinal: number; reason?: string };
export type HeldReceipt = ControlReceipt & { armId?: string; connectionId?: string; requestId?: string };
export type WireObservation = { wireHex: string; bodyHex: string; wireBytes: number; bodyBytes: number; framingComplete: boolean };
export type Terminal = 'complete' | 'aborted' | 'failed' | 'timeout' | 'unknown';
export type QueueSample = { applicationPending: number; headerRetained: number; sourceReadable: number; destinationWritable: number; total: number };
export type QueueObservation = { maxObservedBytes: number; currentSample: QueueSample; peakSample: QueueSample; componentMaxima: QueueSample };
export type ConnectionCounts = { clientFlows: number; upstreamLegs: number; physicalConnections: number; proxySocketHandles: number };
export type TrafficCounts = { readBytes: number; readChunks: number; writeBytes: number; writeChunks: number; writeFalseCount: number; drainCount: number };
export type PrivateControlStep = {
  controlOrdinal: 1 | 2 | 3; operation: 'arm' | 'held' | 'release'; eventOrdinal: number;
  armId: string; connectionId?: string; requestId?: string;
};
export type TransportEvent = {
  schemaVersion: 1; ordinal: number;
  type: 'capture_started' | 'connection_opened' | 'request_identified' | 'armed' | 'held' | 'released'
    | 'write_false' | 'drain' | 'terminal' | 'blocked' | 'observer_lost' | 'capture_closed';
  protocol?: 'HTTP/1.1'; connectionId?: string; requestId?: string; armId?: string;
  direction?: 'request' | 'response'; terminal?: Terminal; reason?: string;
};
export type TransportSnapshot = {
  schemaVersion: 1; protocol: 'HTTP/1.1'; authority: 'TRUSTED_LOOPBACK_INFRASTRUCTURE_ONLY';
  status: 'COMPLETE' | 'BLOCKED' | 'PENDING'; reasons: string[]; limits: Limits;
  privateControlSequence: PrivateControlStep[];
  requests: { connectionId: string; requestId: string; method: string; target: string;
    request: WireObservation; response: WireObservation; terminal: Terminal }[];
  queue: { request: QueueObservation; response: QueueObservation; kernelBuffers: 'UNOBSERVED'; aliasAccounting: string; auditBuffersSeparate: true };
  connections: { active: ConnectionCounts; maxObserved: ConnectionCounts; allFixtureDataSocketHandles: 'UNOBSERVED' };
  traffic: { request: TrafficCounts; response: TrafficCounts };
  backpressure: { direction: 'request' | 'response'; writeFalseOrdinal: number; drainOrdinal: number | null }[];
};
export type TransparentHold = {
  address: Address;
  arm(input: { armId: string; method: 'POST'; target: '/literal/save' }): Promise<ControlReceipt>;
  waitHeld(input: { armId: string; timeoutMs?: number }): Promise<HeldReceipt>;
  release(input: { armId: string; connectionId: string; requestId: string; heldOrdinal: number }): Promise<ControlReceipt>;
  events(): TransportEvent[]; snapshot(): TransportSnapshot;
  close(): Promise<{ closed: boolean; remainingSockets: number }>;
};
export function createTransparentHold(input: { upstream: Address; limits?: Partial<Limits> }): Promise<TransparentHold>;
export function assessTransparentHoldEvents(events: unknown, options?: { maxEvents?: number }): {
  status: 'COMPLETE' | 'BLOCKED' | 'PENDING'; authority: 'IMPORTED_EVENTS_UNTRUSTED'; reasons: string[];
};

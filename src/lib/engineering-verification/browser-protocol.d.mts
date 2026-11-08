export type ProtocolTransport = 'finished' | 'canceled' | 'failed' | 'unknown';
export type ProtocolNavigation = 'document' | 'same_document' | 'none' | 'unknown';
export type ProtocolMimeClass = 'rsc' | 'html' | 'json' | 'other' | 'unknown';
export type ProtocolTerminal = 'finished' | 'canceled' | 'failed' | 'redirect' | 'unknown';
export type ProtocolIdentityKey = string | object;
export type ProtocolEvent = Readonly<{ ordinal: number; kind: string; [key: string]: unknown }>;
export type ProtocolRequest = Readonly<{
  requestId: string; contextId: string; sessionId: string; frameId: string | null; documentId: string | null; hop: number;
  method: string; routeTemplate: string; resourceType: string; sameOrigin: boolean;
  rsc: boolean; routerPrefetch: boolean; nextAction: boolean;
  responseStatus: number | null; responseMimeClass: ProtocolMimeClass; responseUrlMatchesRequest: boolean | null;
  startOrdinal: number; responseOrdinal: number | null; terminalOrdinal: number | null;
  terminal: ProtocolTerminal; transport: ProtocolTransport; redirectToRequestId: string | null;
  navigation: ProtocolNavigation; actionSettlement: 'unknown'; effect: 'unknown';
  canceled: boolean; netError: 'aborted' | 'other' | 'unknown'; blockedReason: string; corsError: string;
}>;
export type ProtocolNavigationRecord = Readonly<{
  navigationId: string; ordinal: number; kind: 'document' | 'same_document'; contextId: string; sessionId: string;
  frameId: string; documentId: string; routeTemplate: string; sameOrigin: boolean;
}>;
export type ProtocolCapture = Readonly<{
  protocolVersion: '1.3' | 'unknown'; completenessScope: 'registered_cdp_sessions'; unobservedTargets: 'unknown';
  schemaVersion: 1; status: 'BLOCKED' | 'LOCAL_PROTOCOL_UNTRUSTED'; complete: boolean; closed: boolean; truncated: boolean;
  events: readonly ProtocolEvent[]; requests: readonly ProtocolRequest[]; navigations: readonly ProtocolNavigationRecord[]; incompleteReasons: readonly string[];
}>;
export type ProtocolCaptureOptions = { protocolVersion?: string; fixtureOrigin: string; routeTemplates: readonly string[]; maxEvents?: number; maxRequests?: number };
export type ProtocolCaptureController = {
  registerSession(sessionKey: ProtocolIdentityKey, options: { contextKey: ProtocolIdentityKey }): void;
  ingest(sessionKey: ProtocolIdentityKey, eventName: string, payload: unknown): void;
  sessionLost(sessionKey: ProtocolIdentityKey): void;
  snapshot(): ProtocolCapture;
  finish(): ProtocolCapture;
};
export function reduceBrowserProtocolCapture(events: readonly ProtocolEvent[], options?: { incompleteReasons?: readonly string[]; truncated?: boolean }): ProtocolCapture;
export function createBrowserProtocolCapture(options: ProtocolCaptureOptions): ProtocolCaptureController;
export type CdpSession = {
  on(event: string, listener: (payload: unknown) => void): unknown;
  off(event: string, listener: (payload: unknown) => void): unknown;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
};
export function attachBrowserProtocolObserver(session: CdpSession, capture: ProtocolCaptureController, options: { sessionKey: ProtocolIdentityKey; contextKey: ProtocolIdentityKey }): Promise<{ stop(): Promise<void> }>;

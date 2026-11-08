// @vitest-environment node
/** Independent acceptance cases from the native-correlation design, written before its implementation. */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { attachBrowserProtocolObserver, createBrowserProtocolCapture, reduceBrowserProtocolCapture } from './browser-protocol.mjs';

const ORIGIN = 'http://127.0.0.1:3197';
const CANARY = 'PRIVATE_CANARY_7b6d34';
const SESSION = 'native-session-' + CANARY;
const FRAME = 'native-frame-' + CANARY;
const LOADER = 'native-loader-' + CANARY;
const ROUTES = ['/fixture', '/same', '/redirect', '/final', '/destination', '/spa', '/action', '/private/[id]'];
const frame = (loaderId = LOADER, frameId = FRAME, url = ORIGIN + '/fixture') => ({ frame: { id: frameId, loaderId, url }, type: 'Navigation' });
function capture(options = {}) {
  const value = createBrowserProtocolCapture({ protocolVersion: '1.3', fixtureOrigin: ORIGIN, routeTemplates: ROUTES, ...options });
  value.registerSession(SESSION, { contextKey: 'native-context-' + CANARY });
  value.ingest(SESSION, 'Page.frameNavigated', frame());
  return value;
}
type Capture = ReturnType<typeof createBrowserProtocolCapture>;
type RequestOptions = { session?: string; loaderId?: string; frameId?: string; url?: string; method?: string;
  headers?: Record<string, string>; [key: string]: unknown };
function start(value: Capture, requestId: string, options: RequestOptions = {}) {
  const { session = SESSION, loaderId = LOADER, frameId = FRAME, url = ORIGIN + '/same', method = 'GET', headers = {}, postData, postDataEntries, ...rest } = options;
  value.ingest(session, 'Network.requestWillBeSent', { requestId, loaderId, frameId, documentURL: ORIGIN + '/fixture',
    timestamp: 100, wallTime: 100, type: 'Fetch', request: { url, method, headers, postData, postDataEntries }, ...rest });
}
function response(value: Capture, requestId: string, options: RequestOptions = {}) {
  const { session = SESSION, loaderId = LOADER, frameId = FRAME, url = ORIGIN + '/same', status = 200,
    mimeType = 'text/x-component', headers = {}, ...rest } = options;
  value.ingest(session, 'Network.responseReceived', { requestId, loaderId, frameId, timestamp: 100, type: 'Fetch',
    response: { url, status, mimeType, headers }, ...rest });
}
function eof(value: Capture, requestId: string, session = SESSION) {
  value.ingest(session, 'Network.loadingFinished', { requestId, timestamp: 100, encodedDataLength: 10 });
}
function canceled(value: Capture, requestId: string, options = {}) {
  value.ingest(SESSION, 'Network.loadingFailed', { requestId, timestamp: 100, type: 'Fetch', canceled: true, errorText: 'net::ERR_ABORTED', ...options });
}
function complete(value: Capture, id = 'native-request-' + CANARY, options = {}) { start(value, id, options); response(value, id, options); eof(value, id); }

/** IDs and error text below are deliberately private-looking; no raw value or digest may survive projection. */
describe('passive browser protocol exact-request correlation', () => {
  it('records an exact native EOF without claiming action settlement, effects or authenticated acceptance', () => {
    const value = capture(); complete(value);
    const result = value.finish();
    expect(result.status).toBe('LOCAL_PROTOCOL_UNTRUSTED');
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({ method: 'GET', routeTemplate: '/same', sameOrigin: true,
      responseStatus: 200, transport: 'finished', actionSettlement: 'unknown', effect: 'unknown' });
  });

  it('never turns response200 into EOF or action fulfillment', () => {
    const value = capture(); start(value, 'a'); response(value, 'a');
    expect(value.snapshot().requests[0]).toMatchObject({ responseStatus: 200, transport: 'unknown', actionSettlement: 'unknown', effect: 'unknown' });
    expect(value.finish().status).toBe('BLOCKED');
  });

  it('does not lend a completed duplicate URL response/EOF to its canceled peer', () => {
    const value = capture(); start(value, 'first'); start(value, 'second'); response(value, 'second'); eof(value, 'second'); canceled(value, 'first');
    const result = value.finish();
    expect(result.requests.map(row => row.transport)).toEqual(['canceled', 'finished']);
    expect(result.requests[0].responseStatus).toBeNull();
    expect(result.requests[0].requestId).not.toBe(result.requests[1].requestId);
    expect(result.status).toBe('BLOCKED');
  });

  it('rejects a response or EOF with no exact preceding request even when another URL matches', () => {
    const value = capture(); start(value, 'a'); response(value, 'other'); eof(value, 'other');
    const result = value.finish();
    expect(result.status).toBe('BLOCKED');
    expect(result.requests[0].transport).toBe('unknown');
  });

  it('separates the same raw request identity across CDP sessions and contexts', () => {
    const value = capture(); value.registerSession('second-session', { contextKey: 'second-context' });
    value.ingest('second-session', 'Page.frameNavigated', frame());
    start(value, 'same-id'); start(value, 'same-id', { session: 'second-session' });
    response(value, 'same-id', { session: 'second-session' }); eof(value, 'same-id', 'second-session');
    const result = value.finish();
    expect(result.requests.map(row => row.transport)).toEqual(['unknown', 'finished']);
    expect(result.requests[0].sessionId).not.toBe(result.requests[1].sessionId);
    expect(result.requests[0].contextId).not.toBe(result.requests[1].contextId);
    expect(result.status).toBe('BLOCKED');
  });

  it('does not borrow a response from a mismatched native frame or loader', () => {
    for (const mismatch of [{ frameId: 'another-frame' }, { loaderId: 'another-loader' }]) {
      const value = capture(); start(value, 'a'); response(value, 'a', mismatch); eof(value, 'a');
      const result = value.finish();
      expect(result.status).toBe('BLOCKED');
      expect(result.requests[0].responseStatus).toBeNull();
    }
  });

  it('keeps redirect hops distinct when CDP deliberately reuses the request ID', () => {
    const value = capture(); start(value, 'redirect-id', { url: ORIGIN + '/redirect' });
    start(value, 'redirect-id', { url: ORIGIN + '/final', redirectResponse: { url: ORIGIN + '/redirect', status: 302, mimeType: 'text/html', headers: { location: ORIGIN + '/final' } } });
    response(value, 'redirect-id', { url: ORIGIN + '/final', mimeType: 'text/plain' }); eof(value, 'redirect-id');
    const result = value.finish();
    expect(result.requests).toHaveLength(2);
    expect(result.requests.map(row => row.routeTemplate)).toEqual(['/redirect', '/final']);
    expect(result.requests.map(row => row.hop)).toEqual([0, 1]);
    expect(result.requests[0].requestId).not.toBe(result.requests[1].requestId);
    expect(result.requests[0]).toMatchObject({ responseStatus: 302, terminal: 'redirect', transport: 'unknown' });
    expect(result.requests[1]).toMatchObject({ responseStatus: 200, transport: 'finished' });
  });

  it('rejects a redirect response that describes another hop URL', () => {
    const value = capture(); start(value, 'a', { url: ORIGIN + '/redirect' });
    start(value, 'a', { url: ORIGIN + '/final', redirectResponse: { url: ORIGIN + '/same', status: 302, headers: {} } });
    response(value, 'a', { url: ORIGIN + '/final' }); eof(value, 'a');
    expect(value.finish().status).toBe('BLOCKED');
  });

  it('blocks overlapping reused request IDs instead of choosing the newer generation', () => {
    const value = capture(); start(value, 'reused');
    value.ingest(SESSION, 'Page.frameNavigated', frame('new-loader'));
    start(value, 'reused', { loaderId: 'new-loader' });
    response(value, 'reused', { loaderId: 'new-loader' }); eof(value, 'reused');
    expect(value.finish().status).toBe('BLOCKED');
  });

  it('keeps full-document generations separate and does not call SPA history a new document', () => {
    const value = capture(); complete(value, 'old');
    value.ingest(SESSION, 'Page.navigatedWithinDocument', { frameId: FRAME, url: ORIGIN + '/spa', navigationType: 'historyApi' });
    complete(value, 'spa');
    value.ingest(SESSION, 'Page.frameNavigated', frame('second-loader', FRAME, ORIGIN + '/destination'));
    complete(value, 'new', { loaderId: 'second-loader' });
    const result = value.finish();
    expect(result.navigations.map(row => row.kind)).toEqual(['document', 'same_document', 'document']);
    expect(result.requests[0].documentId).toBe(result.requests[1].documentId);
    expect(result.requests[1].documentId).not.toBe(result.requests[2].documentId);
    expect(result.requests[0].frameId).toBe(result.requests[2].frameId);
  });

  it('blocks frame removal/reuse while old transport is still unobserved', () => {
    const value = capture(); start(value, 'old');
    value.ingest(SESSION, 'Page.frameDetached', { frameId: FRAME, reason: 'remove' });
    value.ingest(SESSION, 'Page.frameNavigated', frame('replacement-loader'));
    complete(value, 'new', { loaderId: 'replacement-loader' });
    expect(value.finish().status).toBe('BLOCKED');
  });

  it('orders events with strict local ordinals when source clocks are equal or regress', () => {
    const value = capture(); start(value, 'a', { timestamp: 50, wallTime: 900 });
    response(value, 'a', { timestamp: 1 }); eof(value, 'a');
    const result = value.finish(), request = result.requests[0];
    expect(request.startOrdinal).toBeLessThan(request.responseOrdinal!);
    expect(request.responseOrdinal!).toBeLessThan(request.terminalOrdinal!);
    const ordinals = result.events.map(row => row.ordinal);
    expect(new Set(ordinals).size).toBe(ordinals.length);
    expect(ordinals.every((ordinal, i) => i === 0 || ordinal > ordinals[i - 1])).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/wallTime|timestamp/);
  });

  it('retains canceled POST unknown settlement/effect even after a destination navigation finishes', () => {
    const value = capture(); start(value, 'post', { method: 'POST', url: ORIGIN + '/action', headers: { 'Next-Action': CANARY, RSC: '1' } });
    response(value, 'post', { url: ORIGIN + '/action', headers: { 'x-action-redirect': ORIGIN + '/destination' } }); canceled(value, 'post');
    value.ingest(SESSION, 'Page.frameNavigated', frame('destination', FRAME, ORIGIN + '/destination'));
    complete(value, 'destination', { url: ORIGIN + '/destination', loaderId: 'destination' });
    const result = value.finish();
    expect(result.requests[0]).toMatchObject({ method: 'POST', nextAction: true, transport: 'canceled', actionSettlement: 'unknown', effect: 'unknown' });
    expect(result.status).toBe('BLOCKED');
  });

  it('does not infer action fulfillment or a verified write from successful POST transport', () => {
    const value = capture(); complete(value, 'post', { method: 'POST', url: ORIGIN + '/action', headers: { 'next-action': CANARY } });
    expect(value.finish().requests[0]).toMatchObject({ transport: 'finished', actionSettlement: 'unknown', effect: 'unknown' });
  });

  it('keeps a native canceled prefetch blocked without adding a new cancellation exception', () => {
    const value = capture(); start(value, 'prefetch', { headers: { RSC: '1', 'Next-Router-Prefetch': '1' } }); response(value, 'prefetch'); canceled(value, 'prefetch');
    const result = value.finish();
    expect(result.requests[0]).toMatchObject({ rsc: true, routerPrefetch: true, transport: 'canceled' });
    expect(result.status).toBe('BLOCKED');
  });

  it('blocks lost sessions and unregistered session events', () => {
    const lost = capture(); complete(lost); lost.sessionLost(SESSION);
    expect(lost.finish().status).toBe('BLOCKED');
    const unregistered = capture(); start(unregistered, 'a', { session: 'not-registered' });
    expect(unregistered.finish().status).toBe('BLOCKED');
  });

  it('does not reconnect a lost session merely because its raw name is registered again', () => {
    const value = capture(); start(value, 'a'); value.sessionLost(SESSION);
    value.registerSession(SESSION, { contextKey: 'replacement-context' });
    eof(value, 'a');
    expect(value.finish().status).toBe('BLOCKED');
  });

  it('blocks bounded-buffer overflow instead of silently dropping evidence', () => {
    const value = capture({ maxEvents: 3, maxRequests: 1 }); complete(value, 'first'); complete(value, 'second');
    const result = value.finish();
    expect(result.status).toBe('BLOCKED');
    expect(result.incompleteReasons.length).toBeGreaterThan(0);
    expect(result.events.length).toBeLessThanOrEqual(3);
    expect(result.requests.length).toBeLessThanOrEqual(1);
  });

  it('fails closed for malformed required identities and invalid ordering', () => {
    for (const event of [
      ['Network.requestWillBeSent', { requestId: [], request: { url: ORIGIN + '/same', method: 'GET' } }],
      ['Network.responseReceived', { requestId: 'a', response: { status: 200 } }],
      ['Network.loadingFinished', { requestId: 'a' }],
      ['Page.navigatedWithinDocument', { frameId: FRAME, url: ORIGIN + '/spa', navigationType: 'invented' }],
    ] as const) {
      const value = capture(); value.ingest(SESSION, event[0], event[1]);
      expect(value.finish().status).toBe('BLOCKED');
    }
  });

  it('cannot accept a second contradictory terminal or response after EOF', () => {
    const value = capture(); complete(value, 'a'); canceled(value, 'a'); response(value, 'a');
    expect(value.finish().status).toBe('BLOCKED');
  });
});

describe('browser protocol retained privacy', () => {
  it('projects only safe metadata from URL/header/action/native-identity/error canaries', () => {
    const value = capture(); const id = 'raw-request-' + CANARY;
    const url = ORIGIN + '/private/' + CANARY + '?token=' + CANARY + '#' + CANARY;
    start(value, id, { url, headers: { Cookie: CANARY, Authorization: 'Bearer ' + CANARY, 'Next-Action': CANARY,
      RSC: '1', 'Next-Router-Prefetch': '1', 'x-private': CANARY }, postData: CANARY, postDataEntries: [{ bytes: CANARY }], initiator: { stack: { callFrames: [{ url, functionName: CANARY }] } } });
    response(value, id, { url, headers: { 'set-cookie': CANARY, 'content-type': 'text/x-component', 'x-action-redirect': url } });
    canceled(value, id, { errorText: 'raw private failure ' + CANARY, blockedReason: CANARY, corsErrorStatus: { corsError: CANARY, failedParameter: CANARY } });
    const result = value.finish(), serialized = JSON.stringify(result);
    expect(result.requests[0]).toMatchObject({ routeTemplate: '/private/[id]', nextAction: true, rsc: true, routerPrefetch: true });
    expect(serialized).not.toContain(CANARY);
    expect(serialized).not.toMatch(/sha256:|"headers"|"postData"|"initiator"|"errorText"|"documentURL"|"url"/);
    expect(serialized).not.toMatch(/[a-f0-9]{64}/i);
  });

  it('never retains an unknown private route, query, fragment or cross-origin URL', () => {
    for (const url of [ORIGIN + '/unknown/' + CANARY + '?a=' + CANARY + '#' + CANARY, 'https://' + CANARY.toLowerCase() + '.invalid/same']) {
      const value = capture(); complete(value, 'a', { url }); const result = value.finish();
      expect(result.requests[0].routeTemplate).toBe('[unmapped]');
      expect(JSON.stringify(result)).not.toContain(CANARY);
      expect(JSON.stringify(result)).not.toContain(CANARY.toLowerCase());
    }
  });

  it('does not turn arbitrary header values into true protocol booleans', () => {
    const value = capture(); complete(value, 'a', { headers: { rsc: CANARY, 'next-router-prefetch': CANARY } });
    expect(value.finish().requests[0]).toMatchObject({ rsc: false, routerPrefetch: false });
  });
});

describe('passive observer command boundary', () => {
  it('subscribes to native metadata without interception, fetch wrapping, body reads or cache changes', async () => {
    class FakeSession extends EventEmitter {
      commands: string[] = [];
      async send(method: string) { this.commands.push(method); return method === 'Page.getFrameTree' ? { frameTree: { frame: frame().frame } } : {}; }
    }
    const session = new FakeSession(), value = createBrowserProtocolCapture({ protocolVersion: '1.3', fixtureOrigin: ORIGIN, routeTemplates: ROUTES });
    const observer = await attachBrowserProtocolObserver(session, value, { sessionKey: SESSION, contextKey: 'context' });
    expect(session.commands.length).toBeGreaterThan(0);
    expect(session.commands.every(command => ['Network.enable', 'Page.enable', 'Page.getFrameTree'].includes(command))).toBe(true);
    session.emit('Network.requestWillBeSent', { requestId: 'a', loaderId: LOADER, frameId: FRAME, documentURL: ORIGIN + '/fixture',
      request: { url: ORIGIN + '/same', method: 'GET', headers: {} }, type: 'Fetch' });
    session.emit('Network.responseReceived', { requestId: 'a', loaderId: LOADER, frameId: FRAME, type: 'Fetch', response: { url: ORIGIN + '/same', status: 200, mimeType: 'text/plain', headers: {} } });
    session.emit('Network.loadingFinished', { requestId: 'a' });
    expect(value.snapshot().requests).toHaveLength(1);
    await observer.stop();
    expect(session.listenerCount('Network.requestWillBeSent')).toBe(0);
    expect(session.commands.every(command => ['Network.enable', 'Page.enable', 'Page.getFrameTree'].includes(command))).toBe(true);
  });
});


describe('replayed protocol evidence remains validated and private', () => {
  it('reduces a valid safe event inventory without minting authenticated authority', () => {
    const value = capture(); complete(value); const original = value.finish();
    expect(original.events.length).toBeGreaterThan(0);
    const replayed = reduceBrowserProtocolCapture(JSON.parse(JSON.stringify(original.events)));
    expect(replayed.status).toBe('LOCAL_PROTOCOL_UNTRUSTED');
    expect(replayed.requests).toEqual(original.requests);
  });

  it('blocks unknown replay event types without retaining their private fields', () => {
    const events = [{ ordinal: 1, kind: 'UNKNOWN_PROTOCOL_VERSION_' + CANARY, url: CANARY, headers: { cookie: CANARY } }];
    const result = reduceBrowserProtocolCapture(events);
    expect(result.status).toBe('BLOCKED');
    expect(JSON.stringify(result)).not.toContain(CANARY);
  });

  it('blocks extra replay fields rather than accepting raw header/action/native-ID data', () => {
    const value = capture(); complete(value); const original = value.finish();
    expect(original.events.length).toBeGreaterThan(0);
    for (const injected of [{ url: CANARY }, { rawRequestId: CANARY }, { actionId: CANARY },
      { headers: { authorization: CANARY } }, { errorText: CANARY }, { timestamp: 1 }]) {
      const events = JSON.parse(JSON.stringify(original.events));
      Object.assign(events[0], injected);
      const result = reduceBrowserProtocolCapture(events);
      expect(result.status).toBe('BLOCKED');
      expect(JSON.stringify(result)).not.toContain(CANARY);
    }
  });

  it('blocks reordered or repeated local ordinals instead of reconstructing a later success', () => {
    const value = capture(); complete(value); const events = [...value.finish().events];
    expect(events.length).toBeGreaterThan(1);
    for (const changed of [[...events].reverse(), [events[0], events[0], ...events.slice(1)]])
      expect(reduceBrowserProtocolCapture(changed).status).toBe('BLOCKED');
  });
});


describe('protocol setup identity and scoped completeness', () => {
  it('reports registered-session scope without claiming unseen worker/OOPIF/context coverage', () => {
    const value = capture(); complete(value); const result = value.finish();
    expect(result).toMatchObject({ protocolVersion: '1.3', completenessScope: 'registered_cdp_sessions', unobservedTargets: 'unknown' });
  });

  it('blocks unknown or missing protocol versions and never retains an arbitrary version string', () => {
    for (const protocolVersion of [undefined, '999.0', CANARY]) {
      const value = createBrowserProtocolCapture({ fixtureOrigin: ORIGIN, routeTemplates: ROUTES, protocolVersion });
      const result = value.finish();
      expect(result).toMatchObject({ status: 'BLOCKED', protocolVersion: 'unknown' });
      expect(result.incompleteReasons).toContain('unknown_protocol_version');
      expect(JSON.stringify(result)).not.toContain(CANARY);
    }
  });

  it('marks observer setup failure explicitly and never retains raw transport errors', async () => {
    class FailingSession extends EventEmitter {
      async send() { throw new Error('native private setup error ' + CANARY); }
    }
    const value = createBrowserProtocolCapture({ protocolVersion: '1.3', fixtureOrigin: ORIGIN, routeTemplates: ROUTES });
    try { await attachBrowserProtocolObserver(new FailingSession(), value, { sessionKey: SESSION, contextKey: 'context' }); }
    catch { /* Rejection is permitted; the capture itself must retain the safe failure. */ }
    const result = value.finish();
    expect(result.status).toBe('BLOCKED');
    expect(result.incompleteReasons.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(CANARY);
  });
});

it('blocks prototype-named replay kinds without throwing or retaining their fields', () => {
  for (const kind of ['constructor', '__proto__', 'toString']) {
    const events = [{ ordinal: 1, kind, privateValue: CANARY }];
    expect(() => reduceBrowserProtocolCapture(events)).not.toThrow();
    const result = reduceBrowserProtocolCapture(events);
    expect(result.status).toBe('BLOCKED');
    expect(JSON.stringify(result)).not.toContain(CANARY);
  }
});

it('preserves invalid constructor configuration when its safe log is replayed', () => {
  for (const invalid of [
    { fixtureOrigin: 'https://remote.invalid' },
    { fixtureOrigin: ORIGIN + '/private/' + CANARY },
    { routeTemplates: ['/same', '/same'] },
    { routeTemplates: ['/private/' + CANARY] },
    { maxEvents: -1 },
    { maxRequests: -1 },
  ]) {
    const value = capture(invalid); complete(value); const live = value.finish();
    expect(live.status).toBe('BLOCKED');
    expect(live.incompleteReasons).toContain('invalid_configuration');
    const replayed = reduceBrowserProtocolCapture(JSON.parse(JSON.stringify(live.events)));
    expect(replayed.status).toBe('BLOCKED');
    expect(replayed.incompleteReasons).toContain('invalid_configuration');
    expect(JSON.stringify(replayed)).not.toContain(CANARY);
  }
});

it('blocks contradictory replay terminal flags instead of presenting finished canceled transport as complete', () => {
  const value = capture(); complete(value); const original = value.finish();
  for (const contradiction of [
    { canceled: true, netError: 'aborted' },
    { netError: 'other' },
    { blockedReason: 'csp' },
    { corsError: 'MissingAllowOriginHeader' },
    { redirectToRequestId: 'request-2' },
  ]) {
    const events = JSON.parse(JSON.stringify(original.events));
    const terminal = events.find((event: { kind: string }) => event.kind === 'request_terminal');
    Object.assign(terminal, contradiction);
    const result = reduceBrowserProtocolCapture(events);
    expect(result.status).toBe('BLOCKED');
    expect(result.complete).toBe(false);
  }
});

it('bounds replayed generated IDs without retaining attacker-sized values', () => {
  const value = capture(); complete(value); const original = value.finish();
  for (const invalidId of ['request-' + '9'.repeat(1_000_000), 'request-9007199254740992']) {
    const events = JSON.parse(JSON.stringify(original.events));
    for (const event of events) if (Object.hasOwn(event, 'requestId')) event.requestId = invalidId;
    const result = reduceBrowserProtocolCapture(events);
    expect(result.status).toBe('BLOCKED');
    expect(result.complete).toBe(false);
    const serialized = JSON.stringify(result);
    expect(serialized.includes(invalidId)).toBe(false);
    expect(serialized.length).toBeLessThan(64_000);
  }
});

it('rejects a nonzero root hop without an earlier exact redirect predecessor', () => {
  const value = capture(); complete(value); const events = JSON.parse(JSON.stringify(value.finish().events));
  events.find((event: { kind: string }) => event.kind === 'request_started').hop = 4;
  expect(reduceBrowserProtocolCapture(events).status).toBe('BLOCKED');
});

it('rejects repeated generated document, session and navigation definitions instead of overwriting them', () => {
  const value = capture(); complete(value); const original = value.finish();
  for (const kind of ['frame_document', 'session_started', 'navigation']) {
    const events = JSON.parse(JSON.stringify(original.events));
    const index = events.findIndex((event: { kind: string }) => event.kind === kind);
    expect(index).toBeGreaterThanOrEqual(0);
    events.splice(index + 1, 0, { ...events[index] });
    const reordered = events.map((event: Record<string, unknown>, i: number) => ({ ...event, ordinal: i + 1 }));
    expect(reduceBrowserProtocolCapture(reordered).status).toBe('BLOCKED');
  }
});

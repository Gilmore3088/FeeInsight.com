// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('playwright/test', () => ({ test: { extend: vi.fn() }, expect: vi.fn() }));
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(),
  readFileSync: vi.fn((path: string) => path.endsWith('build.json') ? JSON.stringify({ headSha: 'a'.repeat(40), buildId: 'fixture-build' }) : 'fixture-build') }));
vi.mock('node:child_process', () => ({ execFileSync: vi.fn((_command: string, args: string[]) => args[0] === 'rev-parse' ? 'a'.repeat(40) : '') }));
import { withJourneyCapture } from './evidence';

function fixture(status = 'passed', session?: ProtocolSession) {
  const events = new EventEmitter();
  let url = 'http://localhost:3197/pro/reports';
  const frame = { url: () => url };
  const context = { browser: () => ({ version: () => 'offline-fixture' }), newCDPSession: vi.fn(async () => {
    if (!session) throw new Error('No protocol fixture session');
    return session;
  }) };
  const page = Object.assign(events, { mainFrame: () => frame, url: () => url, isClosed: () => false,
    screenshot: vi.fn(), viewportSize: () => ({ width: 390, height: 844 }), context: () => context });
  const attach = vi.fn();
  const info = { project: { use: { baseURL: 'http://localhost:3197' } }, status, testId: 'fixture', title: 'Producer unit test, not an executed browser journey', retry: 0,
    outputPath: (name: string) => '/offline-fixture/' + name, attach };
  function navigation(target: string) {
    url = 'http://localhost:3197' + target;
    events.emit('framenavigated', frame);
    events.emit('response', { request: () => ({ isNavigationRequest: () => true, frame: () => frame }), status: () => 200, url: () => url });
    events.emit('load');
  }
  function failedRequest(method = 'GET', deferFailure = false) {
    const request = { headers: () => ({ rsc: '1', 'next-router-prefetch': '1', cookie: 'private-fixture-cookie' }),
      resourceType: () => 'fetch', method: () => method, url: () => 'http://localhost:3197/pro/monitor?token=private-fixture-token',
      failure: () => ({ errorText: 'net::ERR_ABORTED' }), isNavigationRequest: () => false };
    events.emit('request', request);
    events.emit('response', { request: () => request, status: () => 200, headers: () => ({ 'content-type': 'text/x-component; charset=utf-8' }), url: request.url });
    const fail = () => { events.emit('requestfailed', request); };
    if (!deferFailure) fail();
    return fail;
  }
  const capture = () => JSON.parse(attach.mock.calls.find(call => call[0] === 'journey-browser-evidence')![1].body);
  const run = (work: () => Promise<void>) => withJourneyCapture(page as never, info as never, work);
  const protocolCapture = () => JSON.parse(attach.mock.calls.find(call => call[0] === 'journey-browser-protocol')![1].body);
  return { navigation, failedRequest, capture, protocolCapture, run, page, context, attach };
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('actual browser evidence producer protocol', () => {
  it('retains canceled prefetch metadata and successful superseding load without raw headers or query secrets', async () => {
    const test = fixture();
    await test.run(async () => { test.navigation('/pro/reports'); test.failedRequest(); test.navigation('/pro/analyze'); });
    const capture = test.capture();
    expect(capture.failedRequests).toHaveLength(1);
    expect(capture.failedRequests[0]).toMatchObject({ classification: 'EXPECTED_RSC_PREFETCH_CANCELLATION', rsc: true, routerPrefetch: true,
      responseStatus: 200, supersedingNavigation: { sequence: 2, status: 200, source: 'main-frame-load' } });
    expect(capture.assessment.status).toBe('LOCAL_BROWSER_UNTRUSTED');
    expect(JSON.stringify(capture)).not.toMatch(/private-fixture-cookie|private-fixture-token/);
  });
  it.each(['GET', 'POST'])('keeps %s cancellation blocking without sufficient protocol evidence', async method => {
    const test = fixture();
    await test.run(async () => { test.navigation('/pro/reports'); test.failedRequest(method); if (method === 'POST') test.navigation('/pro/analyze'); });
    expect(test.capture().assessment.status).toBe('BLOCKED');
    expect(test.capture().failedRequests[0].classification).toBe('UNEXPECTED_FAILURE');
  });
  it('does not treat a load before failure in the same millisecond as a superseding load', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123456);
    const test = fixture();
    await test.run(async () => {
      test.navigation('/pro/reports');
      const fail = test.failedRequest('GET', true);
      test.navigation('/pro/analyze');
      fail();
    });
    const capture = test.capture();
    expect(capture.failedRequests[0]).toMatchObject({ classification: 'UNEXPECTED_FAILURE', supersedingNavigation: null });
    expect(capture.assessment.status).toBe('BLOCKED');
  });
  it('does not mask an already failed fixture with a secondary diagnostic exception', async () => {
    vi.stubEnv('ENGINEERING_VERIFICATION', '1');
    const test = fixture('failed');
    await expect(test.run(async () => { test.failedRequest('POST'); })).resolves.toBeUndefined();
    expect(test.capture().assessment.status).toBe('BLOCKED');
  });
  it('preserves the original thrown journey failure while attaching blocked evidence', async () => {
    vi.stubEnv('ENGINEERING_VERIFICATION', '1');
    const test = fixture(), original = new Error('Original journey assertion');
    await expect(test.run(async () => { throw original; })).rejects.toBe(original);
    expect(test.capture().test.status).toBe('failed');
  });
});

const PROTOCOL_CANARY = 'PRIVATE_PRODUCER_CANARY_4b92';
class ProtocolSession extends EventEmitter {
  commands: string[] = [];
  protocolVersion = '1.3';
  setupError: Error | null = null;
  detach = vi.fn(async () => {});
  async send(method: string) {
    this.commands.push(method);
    if (this.setupError) throw this.setupError;
    if (method === 'Browser.getVersion') return { protocolVersion: this.protocolVersion };
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-' + PROTOCOL_CANARY,
      loaderId: 'loader-' + PROTOCOL_CANARY, url: 'http://localhost:3197/pro/reports' } } };
    return {};
  }
  request(method = 'GET', terminal: 'finished' | 'canceled' | 'missing' = 'finished') {
    const id = 'request-' + PROTOCOL_CANARY;
    const url = 'http://localhost:3197/pro/reports/' + PROTOCOL_CANARY + '?secret=' + PROTOCOL_CANARY + '#' + PROTOCOL_CANARY;
    const scope = { requestId: id, loaderId: 'loader-' + PROTOCOL_CANARY, frameId: 'frame-' + PROTOCOL_CANARY };
    this.emit('Network.requestWillBeSent', { ...scope, documentURL: url, type: 'Fetch',
      request: { url, method, headers: { RSC: '1', 'Next-Action': PROTOCOL_CANARY, Cookie: PROTOCOL_CANARY,
        Authorization: 'Bearer ' + PROTOCOL_CANARY }, postData: PROTOCOL_CANARY, postDataEntries: [{ bytes: PROTOCOL_CANARY }] } });
    this.emit('Network.responseReceived', { ...scope, type: 'Fetch', response: { url, status: 200,
      mimeType: 'text/x-component', headers: { 'set-cookie': PROTOCOL_CANARY } } });
    if (terminal === 'finished') this.emit('Network.loadingFinished', { requestId: id });
    if (terminal === 'canceled') this.emit('Network.loadingFailed', { requestId: id, canceled: true, errorText: 'net::ERR_ABORTED', type: 'Fetch' });
  }
}

describe('opt-in separate journey protocol attachment', () => {
  it('does not open or initialize a CDP session while disabled', async () => {
    vi.stubEnv('ENGINEERING_PROTOCOL_CAPTURE', '0');
    const session = new ProtocolSession(), test = fixture('passed', session);
    await test.run(async () => {});
    expect(test.context.newCDPSession).not.toHaveBeenCalled();
    expect(session.commands).toEqual([]);
    expect(test.attach.mock.calls.some(call => call[0] === 'journey-browser-protocol')).toBe(false);
    expect(test.capture().diagnosticPolicy).toBe('next-rsc-prefetch-cancellation-v1');
    expect(test.capture()).not.toHaveProperty('protocolAttachmentFailed');
  });

  it('uses the real collector on native-shaped metadata and attaches it separately without changing v1 assessment', async () => {
    vi.stubEnv('ENGINEERING_PROTOCOL_CAPTURE', '1');
    const session = new ProtocolSession(), test = fixture('passed', session);
    await test.run(async () => { session.request(); });
    expect(session.commands).toEqual(['Browser.getVersion', 'Network.enable', 'Page.enable', 'Page.getFrameTree']);
    const protocol = test.protocolCapture();
    expect(protocol).toMatchObject({ provenance: 'LOCAL_BROWSER_PROTOCOL_UNTRUSTED', status: 'LOCAL_PROTOCOL_UNTRUSTED',
      setupFailed: false, cleanupFailed: false, acceptance: 'NOT_ASSESSED', completenessScope: 'registered_cdp_sessions', unobservedTargets: 'unknown' });
    expect(protocol.capture.requests[0]).toMatchObject({ routeTemplate: '/pro/reports/[id]', responseStatus: 200,
      transport: 'finished', actionSettlement: 'unknown', effect: 'unknown' });
    expect(JSON.stringify(protocol)).not.toContain(PROTOCOL_CANARY);
    expect(JSON.stringify(protocol)).not.toMatch(/"headers"|"postData"|"errorText"|sha256:/);
    expect(test.capture().assessment.status).toBe('LOCAL_BROWSER_UNTRUSTED');
    expect(test.capture()).not.toHaveProperty('protocol');
    expect(session.detach).toHaveBeenCalledOnce();
    expect(session.listenerCount('Network.requestWillBeSent')).toBe(0);
  });

  it('keeps failed CDP setup explicit and fixed while the original journey still executes', async () => {
    vi.stubEnv('ENGINEERING_PROTOCOL_CAPTURE', '1');
    const session = new ProtocolSession(), test = fixture('passed', session), work = vi.fn(async () => {});
    session.setupError = new Error('Private setup error ' + PROTOCOL_CANARY);
    await test.run(work);
    expect(work).toHaveBeenCalledOnce();
    expect(test.protocolCapture()).toMatchObject({ status: 'BLOCKED', setupFailed: true, acceptance: 'NOT_ASSESSED' });
    expect(JSON.stringify(test.protocolCapture())).not.toContain(PROTOCOL_CANARY);
    expect(session.detach).toHaveBeenCalledOnce();
    expect(test.capture().assessment.status).toBe('LOCAL_BROWSER_UNTRUSTED');
  });

  it('retains unknown protocol version as blocked without echoing an arbitrary version string', async () => {
    vi.stubEnv('ENGINEERING_PROTOCOL_CAPTURE', '1');
    const session = new ProtocolSession(), test = fixture('passed', session); session.protocolVersion = PROTOCOL_CANARY;
    await test.run(async () => {});
    expect(test.protocolCapture()).toMatchObject({ status: 'BLOCKED', capture: { protocolVersion: 'unknown', status: 'BLOCKED' } });
    expect(JSON.stringify(test.protocolCapture())).not.toContain(PROTOCOL_CANARY);
  });

  it('keeps HTTP200 without EOF blocked only in the separate metadata attachment', async () => {
    vi.stubEnv('ENGINEERING_PROTOCOL_CAPTURE', '1');
    const session = new ProtocolSession(), test = fixture('passed', session);
    await test.run(async () => { session.request('GET', 'missing'); });
    expect(test.protocolCapture()).toMatchObject({ status: 'BLOCKED', capture: { status: 'BLOCKED' } });
    expect(test.protocolCapture().capture.requests[0]).toMatchObject({ responseStatus: 200, transport: 'unknown' });
    expect(test.capture().assessment.status).toBe('LOCAL_BROWSER_UNTRUSTED');
  });

  it('preserves strict canceled POST blocking and unknown action/effect states while enabled', async () => {
    vi.stubEnv('ENGINEERING_PROTOCOL_CAPTURE', '1'); vi.stubEnv('ENGINEERING_VERIFICATION', '1');
    const session = new ProtocolSession(), test = fixture('passed', session);
    await expect(test.run(async () => { session.request('POST', 'canceled'); test.failedRequest('POST'); })).rejects.toThrow('Browser evidence blocked');
    expect(test.protocolCapture()).toMatchObject({ status: 'BLOCKED', capture: { status: 'BLOCKED' } });
    expect(test.protocolCapture().capture.requests[0]).toMatchObject({ method: 'POST', transport: 'canceled', actionSettlement: 'unknown', effect: 'unknown' });
    expect(test.capture().assessment.status).toBe('BLOCKED');
    expect(test.capture().failedRequests[0].classification).toBe('UNEXPECTED_FAILURE');
  });

  it('marks detach failure safely without replacing the original journey error', async () => {
    vi.stubEnv('ENGINEERING_PROTOCOL_CAPTURE', '1');
    const session = new ProtocolSession(), test = fixture('passed', session), original = new Error('Original journey assertion');
    session.detach.mockRejectedValueOnce(new Error('Private detach error ' + PROTOCOL_CANARY));
    await expect(test.run(async () => { session.request(); throw original; })).rejects.toBe(original);
    expect(test.protocolCapture()).toMatchObject({ status: 'BLOCKED', cleanupFailed: true });
    expect(JSON.stringify(test.protocolCapture())).not.toContain(PROTOCOL_CANARY);
    expect(test.capture().test.status).toBe('failed');
    expect(session.listenerCount('Network.requestWillBeSent')).toBe(0);
  });

  it('preserves the original journey error when the optional protocol attachment fails', async () => {
    vi.stubEnv('ENGINEERING_PROTOCOL_CAPTURE', '1');
    const session = new ProtocolSession(), test = fixture('passed', session), original = new Error('Original journey assertion');
    test.attach.mockImplementation(async (name: string) => {
      if (name === 'journey-browser-protocol') throw new Error('Private attachment error ' + PROTOCOL_CANARY);
    });
    await expect(test.run(async () => { session.request(); throw original; })).rejects.toBe(original);
    expect(session.detach).toHaveBeenCalledOnce();
    expect(test.capture().protocolAttachmentFailed).toBe(true);
    expect(test.capture().test.status).toBe('failed');
  });

  it('reports a fixed safe error and fallback flag when a successful journey cannot attach protocol evidence', async () => {
    vi.stubEnv('ENGINEERING_PROTOCOL_CAPTURE', '1');
    const session = new ProtocolSession(), test = fixture('passed', session);
    test.attach.mockImplementation(async (name: string) => {
      if (name === 'journey-browser-protocol') throw new Error('Private attachment error ' + PROTOCOL_CANARY);
    });
    await expect(test.run(async () => { session.request(); })).rejects.toThrow(/^Browser protocol evidence attachment failed$/);
    expect(test.capture()).toMatchObject({ protocolAttachmentFailed: true, assessment: { status: 'LOCAL_BROWSER_UNTRUSTED' } });
    expect(JSON.stringify(test.capture())).not.toContain(PROTOCOL_CANARY);
    expect(session.detach).toHaveBeenCalledOnce();
  });

  it('still runs and records blocked setup when CDP session creation is unavailable', async () => {
    vi.stubEnv('ENGINEERING_PROTOCOL_CAPTURE', '1');
    const test = fixture(), work = vi.fn(async () => {});
    await test.run(work);
    expect(work).toHaveBeenCalledOnce();
    expect(test.protocolCapture()).toMatchObject({ status: 'BLOCKED', setupFailed: true, capture: null });
    expect(test.capture().assessment.status).toBe('LOCAL_BROWSER_UNTRUSTED');
  });
});

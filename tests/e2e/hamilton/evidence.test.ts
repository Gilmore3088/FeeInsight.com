// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('playwright/test', () => ({ test: { extend: vi.fn() }, expect: vi.fn() }));
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(),
  readFileSync: vi.fn((path: string) => path.endsWith('build.json') ? JSON.stringify({ headSha: 'a'.repeat(40), buildId: 'fixture-build' }) : 'fixture-build') }));
vi.mock('node:child_process', () => ({ execFileSync: vi.fn((_command: string, args: string[]) => args[0] === 'rev-parse' ? 'a'.repeat(40) : '') }));
import { withJourneyCapture } from './evidence';

function fixture(status = 'passed') {
  const events = new EventEmitter();
  let url = 'http://localhost:3197/pro/reports';
  const frame = { url: () => url };
  const page = Object.assign(events, { mainFrame: () => frame, url: () => url, isClosed: () => false,
    screenshot: vi.fn(), viewportSize: () => ({ width: 390, height: 844 }), context: () => ({ browser: () => ({ version: () => 'offline-fixture' }) }) });
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
  return { navigation, failedRequest, capture, run, page };
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

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assessBrowserCapture, safeBrowserUrl, sanitizeBrowserText } from './browser-evidence.mjs';

describe('browser journey evidence boundaries', () => {
  it('retains route evidence without query credentials or identifying form values', () => {
    expect(safeBrowserUrl('http://localhost:3197/pro/reports?token=secret&email=person@test#private')).toBe('http://localhost:3197/pro/reports');
    expect(safeBrowserUrl('data:text/html,secret')).toBe('[non-http URL]');
    expect(safeBrowserUrl('https://bank.test/market-report/signed-access-secret')).toBe('https://bank.test/market-report/[redacted]');
    expect(sanitizeBrowserText('Bearer secret123 token=abc person@example.com')).not.toMatch(/secret123|abc|person@example/);
    expect(sanitizeBrowserText('{"token":"synthetic-token","password":"synthetic-password"}')).not.toMatch(/synthetic-token|synthetic-password/);
    expect(sanitizeBrowserText('Authorization: Basic dXNlcjpwYXNz\nCookie: session=abc; refresh=synthetic-refresh')).not.toMatch(/dXNlcjpwYXNz|abc|synthetic-refresh/);
    expect(safeBrowserUrl('https://bank.test/r/access-secret')).toBe('https://bank.test/r/[redacted]');
    expect(safeBrowserUrl('https://bank.test/pay/report/access-secret')).toBe('https://bank.test/pay/report/[redacted]');
  });

  it('requires clean exact build and successful capture and never promotes imported evidence to trusted proof', () => {
    const capture = {
      identity: { headSha: 'a'.repeat(40), buildHeadSha: 'a'.repeat(40), buildId: 'fresh-build', clean: true },
      test: { status: 'passed' }, screenshot: 'screen.png', truncated: false,
      consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [],
    };
    expect(assessBrowserCapture(capture).status).toBe('LOCAL_BROWSER_UNTRUSTED');
    expect(assessBrowserCapture({ ...capture, identity: { ...capture.identity, clean: false } }).status).toBe('BLOCKED');
    expect(assessBrowserCapture({ ...capture, identity: { ...capture.identity, buildHeadSha: 'b'.repeat(40) } }).status).toBe('BLOCKED');
    expect(assessBrowserCapture({ ...capture, pageErrors: ['unhandled exception'] }).status).toBe('BLOCKED');
    expect(assessBrowserCapture({ ...capture, screenshot: null }).status).toBe('BLOCKED');
    expect(assessBrowserCapture({ ...capture, test: { status: 'skipped' } }).status).toBe('BLOCKED');
    expect(assessBrowserCapture({ ...capture, truncated: true }).status).toBe('BLOCKED');
  });

  it('retains an explicitly identified RSC prefetch cancellation superseded by a successful main-frame load', () => {
    const request = { method: 'GET', url: 'http://localhost:3197/pro/reports', error: 'net::ERR_ABORTED', resourceType: 'fetch',
      fixtureOrigin: 'http://localhost:3197', rsc: true, routerPrefetch: true, responseStatus: 200, rscResponse: true, startedNavigation: 1,
      supersedingNavigation: { sequence: 2, status: 200, url: 'http://localhost:3197/pro/analyze', source: 'main-frame-load', afterFailure: true } };
    const capture = { diagnosticPolicy: 'next-rsc-prefetch-cancellation-v1',
      identity: { headSha: 'a'.repeat(40), buildHeadSha: 'a'.repeat(40), buildId: 'fresh-build', clean: true },
      test: { status: 'passed' }, screenshot: 'screen.png', truncated: false,
      consoleErrors: [], pageErrors: [], failedRequests: [request], httpErrors: [] };
    expect(assessBrowserCapture(capture).status).toBe('LOCAL_BROWSER_UNTRUSTED');
    expect(capture.failedRequests).toHaveLength(1);
    for (const change of [{ method: 'POST' }, { error: 'net::ERR_FAILED' }, { resourceType: 'script' }, { routerPrefetch: false }, { rsc: false },
      { responseStatus: 500 }, { rscResponse: false }, { fixtureOrigin: 'https://other.test' }, { supersedingNavigation: null },
      { supersedingNavigation: { ...request.supersedingNavigation, sequence: 1 } },
      { supersedingNavigation: { ...request.supersedingNavigation, afterFailure: false } },
      { supersedingNavigation: { ...request.supersedingNavigation, url: 'https://other.test/pro/analyze' } },
    ]) expect(assessBrowserCapture({ ...capture, failedRequests: [{ ...request, ...change }] }).status).toBe('BLOCKED');
    expect(assessBrowserCapture({ ...capture, diagnosticPolicy: undefined }).status).toBe('BLOCKED');
    expect(assessBrowserCapture({ ...capture, test: { status: 'failed' } }).status).toBe('BLOCKED');
  });
});

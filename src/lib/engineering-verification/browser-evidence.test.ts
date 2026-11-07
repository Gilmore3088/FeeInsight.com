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
});

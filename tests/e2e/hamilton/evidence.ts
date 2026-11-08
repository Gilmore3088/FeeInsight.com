/** Actual journey capture, including successful renders. No request bodies or credentials are retained. */
import { test as base, expect, type Page, type Request, type TestInfo, type CDPSession } from 'playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { BROWSER_DIAGNOSTIC_POLICY, assessBrowserCapture, classifyBrowserRequestFailure, safeBrowserUrl, sanitizeBrowserText } from '../../../src/lib/engineering-verification/browser-evidence.mjs';

import { createBrowserProtocolCapture, attachBrowserProtocolObserver } from '../../../src/lib/engineering-verification/browser-protocol.mjs';

// Explicit public route templates only. Unmapped URLs retain no path, query or fragment.
const PROTOCOL_ROUTES = ['/', '/login', '/account', '/pro', '/pro/analyze', '/pro/reports', '/pro/reports/[id]', '/pro/simulate', '/pro/monitor', '/pro/settings'];

export { expect };
export type { Page } from 'playwright/test';

export async function withJourneyCapture(page: Page, info: TestInfo, run: () => Promise<void>, name = 'journey'): Promise<void> {
    const consoleErrors: string[] = [], pageErrors: string[] = [];
    type RequestFlags = { resourceType: string; rsc: boolean; routerPrefetch: boolean; responseStatus: number | null; rscResponse: boolean; startedNavigation: number };
    const failedRows: Array<RequestFlags & { method: string; url: string; error: string; failureEvent: number }> = [];
    const requests = new WeakMap<Request, RequestFlags>();
    const navigations: Array<{ sequence: number; url: string; status: number | null; completedEvent: number | null }> = [];
    let captureEvent = 0;
    let navigationSequence = 0;
    let navigationResponse: { url: string; status: number } | null = null;
    const fixtureOrigin = new URL(String(info.project.use.baseURL)).origin;
    const httpErrors: Array<{ method: string; url: string; status: number }> = [];
    const protocolRequested = process.env.ENGINEERING_PROTOCOL_CAPTURE === '1';
    let protocol: ReturnType<typeof createBrowserProtocolCapture> | null = null;
    let protocolObserver: Awaited<ReturnType<typeof attachBrowserProtocolObserver>> | null = null;
    let protocolSession: CDPSession | null = null;
    let protocolSetupFailed = false;
    let protocolAttachmentFailed = false;
    if (protocolRequested) {
      try {
        protocolSession = await page.context().newCDPSession(page);
        const version = await protocolSession.send('Browser.getVersion');
        protocol = createBrowserProtocolCapture({ fixtureOrigin, routeTemplates: PROTOCOL_ROUTES, protocolVersion: version.protocolVersion });
        protocolObserver = await attachBrowserProtocolObserver(protocolSession, protocol, { sessionKey: protocolSession, contextKey: page.context() });
      } catch { protocolSetupFailed = true; } // Fixed code only; protocol exceptions can contain private URLs.
    }
    let truncated = false;
    let runFailed = false;
    const push = <T>(rows: T[], row: T) => { if (rows.length < 500) rows.push(row); else truncated = true; };
    // Arbitrary console text can contain personal data without a recognizable field name.
    const fingerprint = (value: string) => 'sha256:' + createHash('sha256').update(value).digest('hex');
    page.on('request', request => {
      captureEvent++;
      const headers = request.headers(); // Retain explicit protocol booleans only, never headers or action IDs.
      requests.set(request, { resourceType: request.resourceType(), rsc: headers.rsc === '1', routerPrefetch: headers['next-router-prefetch'] === '1',
        responseStatus: null, rscResponse: false, startedNavigation: navigationSequence });
    });
    page.on('framenavigated', frame => {
      captureEvent++;
      if (frame === page.mainFrame()) push(navigations, { sequence: ++navigationSequence, url: safeBrowserUrl(frame.url()), status: null, completedEvent: null });
    });
    page.on('load', () => {
      const completedEvent = ++captureEvent;
      const navigation = navigations.at(-1);
      if (navigation && navigationResponse?.url === page.url() && navigation.url === safeBrowserUrl(page.url()) && new URL(page.url()).origin === fixtureOrigin) {
        navigation.status = navigationResponse.status;
        navigation.completedEvent = completedEvent;
      }
    });
    page.on('console', message => { if (message.type() === 'error') push(consoleErrors, fingerprint(message.text())); });
    page.on('pageerror', error => push(pageErrors, fingerprint(error.message)));
    page.on('requestfailed', request => push(failedRows, { ...(requests.get(request) ?? { resourceType: request.resourceType(), rsc: false, routerPrefetch: false, responseStatus: null, rscResponse: false, startedNavigation: navigationSequence }),
      method: request.method(), url: safeBrowserUrl(request.url()), error: sanitizeBrowserText(request.failure()?.errorText), failureEvent: ++captureEvent }));
    page.on('response', response => {
      captureEvent++;
      const request = response.request(), flags = requests.get(request);
      if (flags) { flags.responseStatus = response.status(); flags.rscResponse = response.headers()['content-type']?.split(';')[0] === 'text/x-component'; }
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigationResponse = { url: response.url(), status: response.status() };
      if (response.status() >= 400) push(httpErrors, { method: request.method(), url: safeBrowserUrl(response.url()), status: response.status() });
    });
    try { await run(); } catch (error) { runFailed = true; throw error; } finally {
    let screenshot: string | null = null;
    if (!page.isClosed()) {
      screenshot = info.outputPath(name + '.png');
      try { await page.screenshot({ path: screenshot, fullPage: true, timeout: 15000 }); await info.attach(name, { path: screenshot, contentType: 'image/png' }); }
      catch { screenshot = null; }
    }
    let identity: Record<string, unknown> = { clean: false };
    try {
      const build = JSON.parse(readFileSync('test-results/engineering-verification/browser/build.json', 'utf8'));
      if (readFileSync('.next/BUILD_ID', 'utf8').trim() !== build.buildId) throw new Error('Served build identity changed');
      identity = { ...build, buildHeadSha: build.headSha,
        headSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        clean: !execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim() };
    } catch { /* Missing or stale identities remain blocked. */ }
    const failedRequests = failedRows.map(row => {
      // Event ordinals establish strict order even when several callbacks share one clock tick.
      const navigation = navigations.find(candidate => candidate.sequence > row.startedNavigation && candidate.completedEvent != null && candidate.completedEvent > row.failureEvent && candidate.status === 200);
      const value = { ...row, fixtureOrigin, supersedingNavigation: navigation ? { sequence: navigation.sequence, completedEvent: navigation.completedEvent, url: navigation.url, status: navigation.status, source: 'main-frame-load', afterFailure: true } : null };
      return { ...value, classification: classifyBrowserRequestFailure(value, BROWSER_DIAGNOSTIC_POLICY) };
    });
    const capture = { schemaVersion: 1, provenance: 'LOCAL_BROWSER_UNTRUSTED', identity, diagnosticPolicy: BROWSER_DIAGNOSTIC_POLICY,
      test: { id: info.testId, title: info.title, status: runFailed ? 'failed' : info.status, retry: info.retry },
      viewport: page.viewportSize(), browser: page.context().browser()?.version() ?? null,
      url: safeBrowserUrl(page.url()), screenshot, truncated, consoleErrors, pageErrors, failedRequests, httpErrors };
    if (protocolRequested) {
      let cleanupFailed = false;
      try { await protocolObserver?.stop(); } catch { cleanupFailed = true; }
      const protocolCapture = protocol?.finish() ?? null;
      try { await protocolSession?.detach(); } catch { cleanupFailed = true; }
      try { await info.attach(name + '-browser-protocol', { body: JSON.stringify({
        schemaVersion: 1, provenance: 'LOCAL_BROWSER_PROTOCOL_UNTRUSTED', identity,
        status: protocolSetupFailed || cleanupFailed || !protocolCapture ? 'BLOCKED' : protocolCapture.status,
        setupFailed: protocolSetupFailed, cleanupFailed, acceptance: 'NOT_ASSESSED',
        completenessScope: 'registered_cdp_sessions', unobservedTargets: 'unknown', capture: protocolCapture,
      }, null, 2), contentType: 'application/json' }); } catch { protocolAttachmentFailed = true; }
    }
    const assessment = assessBrowserCapture(capture);
    await info.attach(name + '-browser-evidence', { body: JSON.stringify({ ...capture, assessment, ...(protocolRequested ? { protocolAttachmentFailed } : {}) }, null, 2), contentType: 'application/json' });
    if (protocolAttachmentFailed && !runFailed && info.status === 'passed') throw new Error('Browser protocol evidence attachment failed');
    if (process.env.ENGINEERING_VERIFICATION === '1' && assessment.status === 'BLOCKED' && !runFailed && info.status === 'passed') throw new Error('Browser evidence blocked: ' + assessment.blockers.join('; '));
    }
}

export const test = base.extend<{ journeyEvidence: void }>({
  journeyEvidence: [async ({ page }, use, info) => {
    await withJourneyCapture(page, info, use);
  }, { auto: true }],
});

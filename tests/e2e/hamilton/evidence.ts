/** Actual journey capture, including successful renders. No request bodies or credentials are retained. */
import { test as base, expect, type Page, type TestInfo } from 'playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { assessBrowserCapture, safeBrowserUrl, sanitizeBrowserText } from '../../../src/lib/engineering-verification/browser-evidence.mjs';

export { expect };
export type { Page } from 'playwright/test';

export async function withJourneyCapture(page: Page, info: TestInfo, run: () => Promise<void>, name = 'journey'): Promise<void> {
    const consoleErrors: string[] = [], pageErrors: string[] = [];
    const failedRequests: Array<{ method: string; url: string; error: string }> = [];
    const httpErrors: Array<{ method: string; url: string; status: number }> = [];
    let truncated = false;
    let runFailed = false;
    const push = <T>(rows: T[], row: T) => { if (rows.length < 500) rows.push(row); else truncated = true; };
    // Arbitrary console text can contain personal data without a recognizable field name.
    const fingerprint = (value: string) => 'sha256:' + createHash('sha256').update(value).digest('hex');
    page.on('console', message => { if (message.type() === 'error') push(consoleErrors, fingerprint(message.text())); });
    page.on('pageerror', error => push(pageErrors, fingerprint(error.message)));
    page.on('requestfailed', request => push(failedRequests, { method: request.method(), url: safeBrowserUrl(request.url()), error: sanitizeBrowserText(request.failure()?.errorText) }));
    page.on('response', response => { if (response.status() >= 400) push(httpErrors, { method: response.request().method(), url: safeBrowserUrl(response.url()), status: response.status() }); });
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
    const capture = { schemaVersion: 1, provenance: 'LOCAL_BROWSER_UNTRUSTED', identity,
      test: { id: info.testId, title: info.title, status: runFailed ? 'failed' : info.status, retry: info.retry },
      viewport: page.viewportSize(), browser: page.context().browser()?.version() ?? null,
      url: safeBrowserUrl(page.url()), screenshot, truncated, consoleErrors, pageErrors, failedRequests, httpErrors };
    const assessment = assessBrowserCapture(capture);
    await info.attach(name + '-browser-evidence', { body: JSON.stringify({ ...capture, assessment }, null, 2), contentType: 'application/json' });
    if (process.env.ENGINEERING_VERIFICATION === '1' && assessment.status === 'BLOCKED' && !runFailed) throw new Error('Browser evidence blocked: ' + assessment.blockers.join('; '));
    }
}

export const test = base.extend<{ journeyEvidence: void }>({
  journeyEvidence: [async ({ page }, use, info) => {
    await withJourneyCapture(page, info, use);
  }, { auto: true }],
});

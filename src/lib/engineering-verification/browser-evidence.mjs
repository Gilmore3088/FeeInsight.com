/** Browser capture is descriptive local evidence. Only authenticated workflow collection can attest provenance. */
export const BROWSER_DIAGNOSTIC_POLICY = 'next-rsc-prefetch-cancellation-v1';

/** A canceled unused prefetch is retained; other failures, including every POST abort, need review. */
export function classifyBrowserRequestFailure(request, policy) {
  const navigation = request?.supersedingNavigation;
  if (policy !== BROWSER_DIAGNOSTIC_POLICY || request?.method !== 'GET' || request?.error !== 'net::ERR_ABORTED'
    || request?.resourceType !== 'fetch' || request?.rsc !== true || request?.routerPrefetch !== true
    || request?.responseStatus !== 200 || request?.rscResponse !== true
    || !Number.isSafeInteger(request?.startedNavigation) || request.startedNavigation < 0
    || !Number.isSafeInteger(navigation?.sequence) || navigation.sequence <= request.startedNavigation
    || navigation?.status !== 200 || navigation?.source !== 'main-frame-load' || navigation?.afterFailure !== true) return 'UNEXPECTED_FAILURE';
  try {
    const origin = new URL(request.fixtureOrigin);
    if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
      || origin.origin !== request.fixtureOrigin || new URL(request.url).origin !== origin.origin
      || new URL(navigation.url).origin !== origin.origin) return 'UNEXPECTED_FAILURE';
  } catch { return 'UNEXPECTED_FAILURE'; }
  return 'EXPECTED_RSC_PREFETCH_CANCELLATION';
}

export function safeBrowserUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      ? url.origin + url.pathname.replace(/\/(market-report|reset-password|verify-email|invite|r|pay\/report)\/[^/]+/gi, '/$1/[redacted]')
      : '[non-http URL]';
  } catch { return '[invalid URL]'; }
}

export function sanitizeBrowserText(value) {
  return String(value).slice(0, 4096)
    .replace(/https?:\/\/[^\s"<>]+/gi, url => safeBrowserUrl(url))
    .replace(/\b(authorization|set-cookie|cookie)\s*[:=][^\r\n]*/gi, '$1=[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|token|secret|password|cookie|authorization|api[_-]?key)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '$1[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]');
}

export function assessBrowserCapture(capture) {
  const blockers = [];
  const identity = capture?.identity;
  if (!/^[a-f0-9]{40}$/.test(identity?.headSha ?? '') || identity?.buildHeadSha !== identity?.headSha
    || typeof identity?.buildId !== 'string' || !identity.buildId || identity.clean !== true) blockers.push('Clean exact candidate build identity unavailable');
  if (capture?.test?.status !== 'passed') blockers.push('Journey did not pass');
  if (typeof capture?.screenshot !== 'string' || !capture.screenshot) blockers.push('Successful screenshot unavailable');
  if (capture?.truncated !== false) blockers.push('Browser diagnostics incomplete or truncated');
  for (const key of ['consoleErrors', 'pageErrors', 'httpErrors']) {
    if (!Array.isArray(capture?.[key])) blockers.push('Missing diagnostic inventory: ' + key);
    else if (capture[key].length) blockers.push('Browser diagnostics require review: ' + key);
  }
  if (!Array.isArray(capture?.failedRequests)) blockers.push('Missing diagnostic inventory: failedRequests');
  else if (capture.failedRequests.some(request => classifyBrowserRequestFailure(request, capture.diagnosticPolicy) !== 'EXPECTED_RSC_PREFETCH_CANCELLATION')) blockers.push('Browser diagnostics require review: failedRequests');
  return { status: blockers.length ? 'BLOCKED' : 'LOCAL_BROWSER_UNTRUSTED', blockers };
}

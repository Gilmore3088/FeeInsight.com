/** Browser capture is descriptive local evidence. Only authenticated workflow collection can attest provenance. */
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
  for (const key of ['consoleErrors', 'pageErrors', 'failedRequests', 'httpErrors']) {
    if (!Array.isArray(capture?.[key])) blockers.push('Missing diagnostic inventory: ' + key);
    else if (capture[key].length) blockers.push('Browser diagnostics require review: ' + key);
  }
  return { status: blockers.length ? 'BLOCKED' : 'LOCAL_BROWSER_UNTRUSTED', blockers };
}

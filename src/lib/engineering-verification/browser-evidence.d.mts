export function safeBrowserUrl(value: string): string;
export function sanitizeBrowserText(value: unknown): string;
export function assessBrowserCapture(capture: unknown): { status: 'BLOCKED' | 'LOCAL_BROWSER_UNTRUSTED'; blockers: string[] };
export const BROWSER_DIAGNOSTIC_POLICY: 'next-rsc-prefetch-cancellation-v1';
export function classifyBrowserRequestFailure(request: unknown, policy: unknown): 'EXPECTED_RSC_PREFETCH_CANCELLATION' | 'UNEXPECTED_FAILURE';

export function safeBrowserUrl(value: string): string;
export function sanitizeBrowserText(value: unknown): string;
export function assessBrowserCapture(capture: unknown): { status: 'BLOCKED' | 'LOCAL_BROWSER_UNTRUSTED'; blockers: string[] };

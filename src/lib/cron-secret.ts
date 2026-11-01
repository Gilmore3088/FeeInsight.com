import { timingSafeEqual } from "node:crypto";

interface CronSecretEnvironment {
  CRON_SECRET?: string;
  REPORT_CRON_SECRET?: string;
}

/**
 * True when the header carries a scheduled-job secret. BFI_REVALIDATE_TOKEN is deliberately
 * not accepted: it guards only /api/revalidate, and a leaked page-refresh token must not start
 * agent ticks, outreach or digests (security review, 2026-11-01).
 */
export function matchesConfiguredCronSecret(
  headerSecret: string | null,
  environment: CronSecretEnvironment = {
    CRON_SECRET: process.env.CRON_SECRET,
    REPORT_CRON_SECRET: process.env.REPORT_CRON_SECRET,
  },
): boolean {
  const candidate = normalizeSecret(headerSecret);
  if (!candidate) return false;

  return [environment.CRON_SECRET, environment.REPORT_CRON_SECRET]
    .map((secret) => secret?.trim())
    .filter((secret): secret is string => Boolean(secret))
    .some((secret) => secureEqual(candidate, secret));
}

function normalizeSecret(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().startsWith("bearer ")
    ? trimmed.slice("bearer ".length).trim()
    : trimmed;
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

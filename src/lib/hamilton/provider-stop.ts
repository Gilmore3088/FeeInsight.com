/**
 * Server-side: is this error one of the deliberate stops on Hamilton's paid calls (the provider
 * stop in automation-control, the spend breaker, the provider budget)? Each is recorded as
 * "blocked" on the provider ledger by guardProviderCall; the reader gets HAMILTON_STOPPED_MESSAGE
 * (provider-paused.ts), never the internal reason (V5 T6).
 */
import { ProviderBudgetBlockedError } from "@/lib/api-hardening/budget";
import { ProviderCircuitOpenError } from "@/lib/ai-provider-usage";
import { EmergencyStopActiveError } from "@/lib/automation-control";

export function isProviderStopError(error: unknown): boolean {
  return error instanceof EmergencyStopActiveError
    || error instanceof ProviderCircuitOpenError
    || error instanceof ProviderBudgetBlockedError;
}

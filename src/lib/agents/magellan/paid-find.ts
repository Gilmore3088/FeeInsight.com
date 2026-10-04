import { emptyPaidPassResult, type PaidPassResult, type PaidStepOptions } from "@/lib/agents/paid-pass";

/** Pass 3 for Magellan: find a fee schedule link for banks every free finder missed. */
export async function runMagellanPaidFind(options: PaidStepOptions): Promise<PaidPassResult> {
  return emptyPaidPassResult(Boolean(options.dryRun));
}

import { emptyPaidPassResult, type PaidPassResult, type PaidStepOptions } from "@/lib/agents/paid-pass";

/** Pass 3 for Rosetta: read scans and JavaScript-only pages that free readers could not. */
export async function runRosettaPaidRead(options: PaidStepOptions): Promise<PaidPassResult> {
  return emptyPaidPassResult(Boolean(options.dryRun));
}

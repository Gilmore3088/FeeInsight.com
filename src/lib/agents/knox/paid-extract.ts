import { emptyPaidPassResult, type PaidPassResult, type PaidStepOptions } from "@/lib/agents/paid-pass";

/** Pass 3 for Knox: extract fees from dense documents where the rules found few. */
export async function runKnoxPaidExtract(options: PaidStepOptions): Promise<PaidPassResult> {
  return emptyPaidPassResult(Boolean(options.dryRun));
}

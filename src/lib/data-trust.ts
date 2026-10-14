export const DATA_TRUST_QUEUE_STATES = [
  "source_needed",
  "submitted_source_pending_review",
  "source_accepted_awaiting_validation",
  "source_failed",
  "extracted_rows_pending_classification",
  "verified_public_ready",
] as const;

export type DataTrustQueueState = (typeof DATA_TRUST_QUEUE_STATES)[number];
export type DataTrustSeverity = "critical" | "warning" | "work" | "ok";
export type DataTrustOwner = "atlas" | "magellan" | "darwin" | "knox" | "hamilton";

export interface DataTrustQueueInput {
  feeScheduleUrl?: string | null;
  verifiedFeeCount?: number | null;
  provisionalFeeCount?: number | null;
  rawFeeCount?: number | null;
  rawWithoutVerifiedCount?: number | null;
  verifiedWithoutPublishedCount?: number | null;
  latestSourceStatus?: string | null;
  latestExtractedFeeCount?: number | null;
  pendingSubmissionCount?: number | null;
  acceptedSubmissionCount?: number | null;
  validationQueueCount?: number | null;
  automationEnabled?: boolean | null;
}

export interface DataTrustQueueDecision {
  state: DataTrustQueueState;
  label: string;
  severity: DataTrustSeverity;
  owner: DataTrustOwner;
  nextAction: string;
  publicLabel: string;
}

function count(value: number | null | undefined): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function classifyDataTrustQueue(
  input: DataTrustQueueInput,
): DataTrustQueueDecision {
  const verifiedFeeCount = count(input.verifiedFeeCount);
  const rawWithoutVerifiedCount = count(input.rawWithoutVerifiedCount);
  const verifiedWithoutPublishedCount = count(input.verifiedWithoutPublishedCount);
  const latestExtractedFeeCount = count(input.latestExtractedFeeCount);
  const pendingSubmissionCount = count(input.pendingSubmissionCount);
  const acceptedSubmissionCount = count(input.acceptedSubmissionCount);
  const validationQueueCount = count(input.validationQueueCount);
  const latestSourceStatus = input.latestSourceStatus ?? null;
  const hasFeeUrl = hasText(input.feeScheduleUrl);
  const automationEnabled = input.automationEnabled === true;

  if (pendingSubmissionCount > 0) {
    return {
      state: "submitted_source_pending_review",
      label: "Source submitted",
      severity: "work",
      owner: "atlas",
      nextAction: "Review the submitted official source and decide whether it is usable.",
      publicLabel: "Source submitted, pending review.",
    };
  }

  if ((acceptedSubmissionCount > 0 || validationQueueCount > 0) && latestSourceStatus !== "success" && verifiedFeeCount === 0) {
    return {
      state: "source_accepted_awaiting_validation",
      label: "Accepted source",
      severity: "work",
      owner: automationEnabled ? "magellan" : "atlas",
      nextAction: automationEnabled
        ? "Queue validation from the accepted source when explicitly approved."
        : "Automation is stopped; hold for manual validation or rerun after cost guards are cleared.",
      publicLabel: "Source accepted, awaiting validation.",
    };
  }

  if (latestSourceStatus === "failed") {
    return {
      state: "source_failed",
      label: "Source failed",
      severity: "critical",
      owner: "magellan",
      nextAction: "Inspect the latest source error before rerunning collection.",
      publicLabel: "Source collection failed; review is needed.",
    };
  }

  if (rawWithoutVerifiedCount > 0 || (latestExtractedFeeCount > 0 && verifiedFeeCount === 0)) {
    return {
      state: "extracted_rows_pending_classification",
      label: "Rows extracted",
      severity: "warning",
      owner: "darwin",
      nextAction: "Classify raw observations into canonical verified fee rows.",
      publicLabel: "Fee evidence is extracted and awaiting review.",
    };
  }

  if (verifiedWithoutPublishedCount > 0) {
    return {
      state: "extracted_rows_pending_classification",
      label: "Verified, unpublished",
      severity: "warning",
      owner: "hamilton",
      nextAction: "Publish verified rows into the public fee catalog or document why they are withheld.",
      publicLabel: "Fee evidence is verified internally and awaiting publication.",
    };
  }

  if (verifiedFeeCount > 0) {
    return {
      state: "verified_public_ready",
      label: "Public ready",
      severity: "ok",
      owner: "hamilton",
      nextAction: "Monitor freshness and keep verified benchmark rows current.",
      publicLabel: "Verified fee evidence is available.",
    };
  }

  if (!hasFeeUrl) {
    return {
      state: "source_needed",
      label: "Source needed",
      severity: "warning",
      owner: "magellan",
      nextAction: "Find or request an official fee schedule URL.",
      publicLabel: "Official fee schedule needed.",
    };
  }

  return {
    state: "source_accepted_awaiting_validation",
    label: "Source awaiting validation",
    severity: "work",
    owner: automationEnabled ? "magellan" : "atlas",
    nextAction: automationEnabled
      ? "Validate this source through the collection pipeline when explicitly queued."
      : "Automation is stopped; source is ready for manual validation or a later guarded run.",
    publicLabel: "Source on file, awaiting validation.",
  };
}

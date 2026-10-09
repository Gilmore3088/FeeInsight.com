export type InstitutionQualityCode =
  | "bad_or_suspect_url"
  | "url_but_zero_published"
  | "extracted_not_published"
  | "latest_source_failed"
  | "provider_failure"
  | "no_published_fees"
  | "identity_gap"
  | "verified";

export type InstitutionQualitySeverity = "ok" | "info" | "warning" | "critical";
export type InstitutionQualityStatus = "verified" | "needs_review";
export type FeePublicationStatus =
  | "verified"
  | "provisional"
  | "under_review"
  | "unavailable";

export type InstitutionInsightReadiness =
  | "ready"
  | "directional"
  | "under_review"
  | "source_needed";

export type InstitutionSourceNeededReason =
  | "not_applicable"
  | "official_source_missing"
  | "source_needs_extraction"
  | "latest_source_failed"
  | "review_needed";

export type InstitutionQualityFilter =
  | "needs_review"
  | "url_but_zero_fees"
  | "extracted_not_published"
  | "latest_failed"
  | "missing_url"
  | "verified";

export type AgentFailureClass =
  | "none"
  | "provider_credit"
  | "tool_protocol"
  | "timeout"
  | "other";

export interface InstitutionQualitySignal {
  code: InstitutionQualityCode;
  severity: InstitutionQualitySeverity;
  label: string;
  detail: string;
  evidence: Record<string, string | number | boolean | null>;
  last_seen_at: string | null;
  recommended_action: string;
}

export interface InstitutionQualityInput {
  source: string | null;
  certNumber: string | null;
  rssdId?: string | null;
  lei?: string | null;
  websiteUrl: string | null;
  feeScheduleUrl: string | null;
  publishedFeeCount: number | null;
  latestSourceStatus?: string | null;
  latestExtractedFeeCount?: number | null;
  latestSourceError?: string | null;
  latestSourceCollectedAt?: string | null;
  lastAgentFailureClass?: AgentFailureClass | string | null;
}

export interface InstitutionQualityResult {
  quality_status: InstitutionQualityStatus;
  quality_signals: InstitutionQualitySignal[];
  primary_signal: InstitutionQualitySignal;
  recommended_action: string;
}

export interface FeePublicationStatusInput {
  publishedFeeCount: number | null;
  provisionalFeeCount?: number | null;
  latestExtractedFeeCount?: number | null;
  latestSourceStatus?: string | null;
  feeScheduleUrl?: string | null;
}

export interface InstitutionReadinessInput extends FeePublicationStatusInput {
  feePublicationStatus?: FeePublicationStatus;
}

export const INSTITUTION_QUALITY_FILTERS: InstitutionQualityFilter[] = [
  "needs_review",
  "url_but_zero_fees",
  "extracted_not_published",
  "latest_failed",
  "missing_url",
  "verified",
];

const SUSPECT_URL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\/ir\/news\//i, reason: "investor news page" },
  { pattern: /\bpress[-_/]?release\b/i, reason: "press release page" },
  { pattern: /\bnews(room)?\b/i, reason: "news page" },
  { pattern: /page[-_]?not[-_]?found/i, reason: "not-found page" },
  { pattern: /shareholder[-_]?rights/i, reason: "shareholder disclosure" },
  { pattern: /credit-card-agreements/i, reason: "credit card agreement source" },
  { pattern: /wrap[-_]?fee[-_]?agreement/i, reason: "investment wrap fee source" },
  { pattern: /advice\/understanding-banking-fees/i, reason: "consumer advice article" },
];

function hasValue(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function classifyAgentFailure(
  error: string | null | undefined,
): AgentFailureClass {
  if (!hasValue(error)) return "none";
  const lower = String(error).toLowerCase();
  if (lower.includes("credit balance is too low") || lower.includes("reached your specified api usage limits")) return "provider_credit";
  if (lower.includes("tool_use")) return "tool_protocol";
  if (lower.includes("timeout") || lower.includes("timed out")) return "timeout";
  return "other";
}

export function getFeeUrlSuspicion(
  feeScheduleUrl: string | null | undefined,
): { suspect: boolean; reason: string | null } {
  const url = feeScheduleUrl?.trim() ?? "";
  if (!url) return { suspect: false, reason: null };
  for (const { pattern, reason } of SUSPECT_URL_PATTERNS) {
    if (pattern.test(url)) return { suspect: true, reason };
  }
  return { suspect: false, reason: null };
}

export function repairHrefForQualitySignal(
  signal: InstitutionQualitySignal,
): string {
  switch (signal.code) {
    case "bad_or_suspect_url":
    case "url_but_zero_published":
    case "latest_source_failed":
      return "/admin/magellan";
    case "extracted_not_published":
      return "/admin/darwin";
    case "provider_failure":
      return "/admin/agents/health";
    case "no_published_fees":
      return "/admin/magellan";
    case "identity_gap":
      return "/admin/data";
    case "verified":
      return "/admin/institutions?quality=verified";
  }
}

export function getPublicInstitutionQualityLabel(
  signals: InstitutionQualitySignal[],
): string {
  const primary = signals[0];
  if (!primary || primary.code === "verified") return "Verified fees";
  if (primary.code === "identity_gap") return "Institution profile incomplete";
  if (primary.code === "bad_or_suspect_url") return "Fee schedule under review";
  if (primary.code === "url_but_zero_published") return "Fee schedule not verified";
  if (primary.code === "extracted_not_published") return "Fee data pending review";
  if (primary.code === "no_published_fees") return "Fee data unavailable";
  return "Fee schedule under review";
}

export function getFeePublicationStatus(
  input: FeePublicationStatusInput,
): FeePublicationStatus {
  const publishedFeeCount = Number(input.publishedFeeCount ?? 0);
  const provisionalFeeCount = Number(input.provisionalFeeCount ?? 0);
  const latestExtractedFeeCount = Number(input.latestExtractedFeeCount ?? 0);
  const hasFeeUrl = hasValue(input.feeScheduleUrl);
  const hasSourceAttempt = hasValue(input.latestSourceStatus);

  if (publishedFeeCount > 0) return "verified";
  if (provisionalFeeCount > 0) return "provisional";
  if (latestExtractedFeeCount > 0 || hasFeeUrl || hasSourceAttempt) return "under_review";
  return "unavailable";
}

export function getFeePublicationStatusLabel(
  status: FeePublicationStatus,
): string {
  switch (status) {
    case "verified":
      return "Verified fees";
    case "provisional":
      return "Provisional fees";
    case "under_review":
      return "Fee data under review";
    case "unavailable":
      return "Fee data unavailable";
  }
}

export function getInstitutionInsightReadiness(
  input: InstitutionReadinessInput,
): InstitutionInsightReadiness {
  const status =
    input.feePublicationStatus ??
    getFeePublicationStatus({
      publishedFeeCount: input.publishedFeeCount,
      provisionalFeeCount: input.provisionalFeeCount,
      latestExtractedFeeCount: input.latestExtractedFeeCount,
      latestSourceStatus: input.latestSourceStatus,
      feeScheduleUrl: input.feeScheduleUrl,
    });

  switch (status) {
    case "verified":
      return "ready";
    case "provisional":
      return "directional";
    case "under_review":
      return "under_review";
    case "unavailable":
      return "source_needed";
  }
}

export function getInstitutionSourceNeededReason(
  input: InstitutionReadinessInput,
): InstitutionSourceNeededReason {
  const status =
    input.feePublicationStatus ??
    getFeePublicationStatus({
      publishedFeeCount: input.publishedFeeCount,
      provisionalFeeCount: input.provisionalFeeCount,
      latestExtractedFeeCount: input.latestExtractedFeeCount,
      latestSourceStatus: input.latestSourceStatus,
      feeScheduleUrl: input.feeScheduleUrl,
    });

  if (status === "verified" || status === "provisional") return "not_applicable";
  if (input.latestSourceStatus === "failed") return "latest_source_failed";

  const latestExtractedFeeCount = Number(input.latestExtractedFeeCount ?? 0);
  const hasFeeUrl = hasValue(input.feeScheduleUrl);
  const hasSourceAttempt = hasValue(input.latestSourceStatus);

  if (!hasFeeUrl && !hasSourceAttempt && latestExtractedFeeCount === 0) {
    return "official_source_missing";
  }
  if (hasFeeUrl && latestExtractedFeeCount === 0) {
    return "source_needs_extraction";
  }
  return "review_needed";
}

export function getInstitutionConfidenceSummary(
  input: InstitutionReadinessInput,
): string {
  const readiness = getInstitutionInsightReadiness(input);

  switch (readiness) {
    case "ready":
      return "Verified fee evidence supports benchmark comparisons.";
    case "directional":
      return "Provisional evidence supports directional analysis, but not verified benchmark scoring.";
    case "under_review":
      return "Source or extraction evidence exists, but public fee conclusions require review.";
    case "source_needed":
      return "Official source evidence is needed before fee claims can be made.";
  }
}

export function getInstitutionSourceNeededReasonLabel(
  reason: InstitutionSourceNeededReason,
): string {
  switch (reason) {
    case "not_applicable":
      return "No source gap";
    case "official_source_missing":
      return "Official fee schedule needed";
    case "source_needs_extraction":
      return "Source needs extraction";
    case "latest_source_failed":
      return "Latest source collection failed";
    case "review_needed":
      return "Evidence needs review";
  }
}

export function classifyInstitutionQuality(
  input: InstitutionQualityInput,
): InstitutionQualityResult {
  const publishedFeeCount = Number(input.publishedFeeCount ?? 0);
  const latestExtractedFeeCount = Number(input.latestExtractedFeeCount ?? 0);
  const hasFeeUrl = hasValue(input.feeScheduleUrl);
  const failureClass =
    input.lastAgentFailureClass && input.lastAgentFailureClass !== "none"
      ? String(input.lastAgentFailureClass)
      : classifyAgentFailure(input.latestSourceError);
  const suspicion = getFeeUrlSuspicion(input.feeScheduleUrl);

  const signals: InstitutionQualitySignal[] = [];

  if (failureClass === "provider_credit") {
    signals.push({
      code: "provider_failure",
      severity: "critical",
      label: "Provider failure",
      detail: "Latest collection was blocked by AI provider billing or routing.",
      evidence: { failure_class: failureClass },
      last_seen_at: input.latestSourceCollectedAt ?? null,
      recommended_action: "Resolve provider access, then rerun Magellan fetch.",
    });
  }

  if (suspicion.suspect) {
    signals.push({
      code: "bad_or_suspect_url",
      severity: "warning",
      label: "Suspect fee URL",
      detail: `Stored fee URL looks like a ${suspicion.reason}, not a durable fee schedule.`,
      evidence: { fee_schedule_url: input.feeScheduleUrl ?? null, reason: suspicion.reason },
      last_seen_at: input.latestSourceCollectedAt ?? null,
      recommended_action: "Run Magellan discovery to replace or clear this URL.",
    });
  }

  if (
    input.latestSourceStatus === "success" &&
    latestExtractedFeeCount > 0 &&
    publishedFeeCount === 0
  ) {
    signals.push({
      code: "extracted_not_published",
      severity: "warning",
      label: "Extracted, not published",
      detail: "The latest source document produced fee observations, but none reached the published catalog.",
      evidence: {
        latest_extracted_fee_count: latestExtractedFeeCount,
        published_fee_count: publishedFeeCount,
      },
      last_seen_at: input.latestSourceCollectedAt ?? null,
      recommended_action: "Route extracted observations through Darwin classification and Hamilton publish.",
    });
  }

  if (input.latestSourceStatus === "failed") {
    signals.push({
      code: "latest_source_failed",
      severity: failureClass === "provider_credit" ? "critical" : "warning",
      label: "Latest source failed",
      detail: "The most recent source collection did not complete successfully.",
      evidence: { failure_class: failureClass, latest_source_status: input.latestSourceStatus },
      last_seen_at: input.latestSourceCollectedAt ?? null,
      recommended_action: "Rerun Magellan fetch after resolving the latest failure.",
    });
  }

  if (hasFeeUrl && publishedFeeCount === 0) {
    signals.push({
      code: "url_but_zero_published",
      severity: "warning",
      label: "URL, zero fees",
      detail: "A fee URL exists, but no non-rejected fees are published for this institution.",
      evidence: { published_fee_count: publishedFeeCount, fee_schedule_url: input.feeScheduleUrl ?? null },
      last_seen_at: input.latestSourceCollectedAt ?? null,
      recommended_action: "Run Magellan fetch and Darwin classification for this URL.",
    });
  }

  if (!hasFeeUrl && latestExtractedFeeCount === 0 && publishedFeeCount === 0) {
    signals.push({
      code: "no_published_fees",
      severity: "info",
      label: "No published fees",
      detail: "No approved consumer fee observations are published for this institution.",
      evidence: { published_fee_count: publishedFeeCount },
      last_seen_at: input.latestSourceCollectedAt ?? null,
      recommended_action: "Discover a durable fee schedule source, then route observations through review.",
    });
  }

  if (!hasValue(input.source) || !hasValue(input.certNumber) || !hasValue(input.websiteUrl)) {
    signals.push({
      code: "identity_gap",
      severity: "info",
      label: "Identity gap",
      detail: "Core institution identity evidence is incomplete.",
      evidence: {
        source: input.source ?? null,
        cert_number: input.certNumber ?? null,
        website_url: input.websiteUrl ?? null,
        rssd_id: input.rssdId ?? null,
        lei: input.lei ?? null,
      },
      last_seen_at: input.latestSourceCollectedAt ?? null,
      recommended_action: "Refresh FDIC or NCUA identity data before fee discovery.",
    });
  }

  if (signals.length === 0) {
    const verified: InstitutionQualitySignal = {
      code: "verified",
      severity: "ok",
      label: "Verified fees",
      detail: "Published fee records exist and no source quality issue is currently flagged.",
      evidence: { published_fee_count: publishedFeeCount },
      last_seen_at: input.latestSourceCollectedAt ?? null,
      recommended_action: "No repair needed.",
    };
    return {
      quality_status: "verified",
      quality_signals: [verified],
      primary_signal: verified,
      recommended_action: verified.recommended_action,
    };
  }

  return {
    quality_status: "needs_review",
    quality_signals: signals,
    primary_signal: signals[0],
    recommended_action: signals[0].recommended_action,
  };
}

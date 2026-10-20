import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  getFeesByInstitution,
  getFinancialsByInstitution,
  getInstitutionById,
} from "@/lib/data-store";
import {
  getInstitutionPeerRanking,
  getInstitutionRevenueTrend,
} from "@/lib/data-store/call-reports";
import {
  getInstitutionFeeScheduleEvidence,
  getInstitutionSubmissionState,
} from "@/lib/data-store/institution";
import { getAutomationControl } from "@/lib/automation-control";
import { getCurrentUser, hasPermission } from "@/lib/auth";

interface RouteProps {
  params: Promise<{ id: string }>;
}

function withTimeout<T>(promise: Promise<T>, fallback: T, ms = 3500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * One institution's whole evidence record: every live fee, the pipeline's unpublished verified and
 * raw rows, financials and peer ranking, in seven reads. Staff only (analyst or admin): anonymous,
 * a walk over ids pulled the cleaned database as JSON, and nothing on the public site calls it.
 */
async function handleGET(_request: Request, { params }: RouteProps) {
  const user = await getCurrentUser().catch(() => null);
  if (!user || !hasPermission(user, "operate")) {
    return NextResponse.json({ error: "Sign in with a staff account to read this." }, { status: 401 });
  }

  const { id } = await params;
  const institutionId = Number(id);
  if (!Number.isInteger(institutionId) || institutionId <= 0) {
    return NextResponse.json({ error: "Invalid institution ID" }, { status: 400 });
  }

  const institution = await getInstitutionById(institutionId).catch(() => null);

  if (!institution) {
    return NextResponse.json({ error: "Institution not found" }, { status: 404 });
  }

  const [fees, financials, revenueTrend, peerRanking, evidence, submissionState, automation] =
    await Promise.all([
      withTimeout(getFeesByInstitution(institutionId).catch(() => []), []),
      withTimeout(getFinancialsByInstitution(institutionId).catch(() => []), []),
      withTimeout(getInstitutionRevenueTrend(institutionId).catch(() => []), []),
      withTimeout(getInstitutionPeerRanking(institutionId).catch(() => null), null),
      withTimeout(getInstitutionFeeScheduleEvidence(institutionId).catch(() => null), null),
      withTimeout(getInstitutionSubmissionState(institutionId), {
        status: "none" as const,
        label: "No source submission recorded.",
        submission_count: 0,
        pending_count: 0,
        accepted_count: 0,
        rejected_count: 0,
        needs_info_count: 0,
        latest_submission: null,
      }),
      withTimeout(getAutomationControl().catch(() => null), null),
    ]);

  const visibleFees = fees.filter((fee) => fee.review_status !== "rejected");
  const verifiedRows = visibleFees.filter((fee) => fee.review_status === "approved");
  const provisionalRows = visibleFees.filter((fee) => fee.review_status !== "approved");
  const verifiedFeeCount = institution.published_fee_count ?? verifiedRows.length;
  const provisionalFeeCount = institution.provisional_fee_count ?? provisionalRows.length;

  return NextResponse.json({
    institution_id: institution.id,
    identity: {
      name: institution.institution_name,
      city: institution.city,
      state_code: institution.state_code,
      charter_type: institution.charter_type,
      asset_size: institution.asset_size,
      asset_size_tier: institution.asset_size_tier,
      fed_district: institution.fed_district,
      website_url: institution.website_url,
      fee_schedule_url: institution.fee_schedule_url,
    },
    fee_publication_status: institution.fee_publication_status ?? "unavailable",
    insight_readiness: institution.insight_readiness ?? "source_needed",
    source_needed_reason: institution.source_needed_reason ?? "official_source_missing",
    confidence_summary: institution.confidence_summary,
    counts: {
      verified_fee_count: verifiedFeeCount,
      provisional_fee_count: provisionalFeeCount,
      visible_fee_count: verifiedFeeCount + provisionalFeeCount,
      pipeline_counts: evidence?.pipeline_counts ?? null,
    },
    fees: {
      verified: verifiedRows,
      provisional: provisionalRows,
      pipeline_verified_unpublished: evidence?.verified_fee_preview ?? [],
      pipeline_raw_unverified: evidence?.raw_fee_preview ?? [],
    },
    source: {
      latest_status: institution.latest_source_status ?? null,
      latest_collected_at: institution.latest_source_collected_at ?? null,
      latest_document: evidence?.latest_document ?? null,
      latest_text: evidence?.latest_text
        ? {
            status: evidence.latest_text.status,
            source_url: evidence.latest_text.source_url,
            document_type: evidence.latest_text.document_type,
            char_count: evidence.latest_text.char_count,
            updated_at: evidence.latest_text.updated_at,
          }
        : null,
    },
    submission_state: submissionState,
    financials: {
      latest: financials[0] ?? null,
      revenue_trend: revenueTrend,
      peer_ranking: peerRanking,
    },
    quality: {
      label: institution.quality_label ?? null,
      status: institution.quality_status ?? null,
      signals: institution.quality_signals ?? [],
    },
    automation: automation
      ? {
          enabled: automation.enabled,
          public_status: automation.enabled
            ? "Automated source collection is enabled."
            : "Automated extraction is paused; submissions are queued for review.",
          changed_at: automation.changedAt,
        }
      : null,
  });
}

export const GET = withApiRoutePolicy("api.institutions.evidence", "GET", handleGET);

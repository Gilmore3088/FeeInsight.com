export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { formatAssets } from "@/lib/format";
import { FeeTable } from "./fee-table";
import {
  getInstitution,
  getInstitutionFees,
  getInstitutionFeeScheduleEvidence,
  getInstitutionCrawlHistory,
  getInstitutionAgentResults,
  getInstitutionLearnedNotes,
  type Institution,
  type InstitutionLearnedNotes,
  type InstitutionFeeScheduleEvidence,
} from "@/lib/data-store/institution";
import { InstitutionActions } from "./institution-actions";
import { getInstitutionPeerRanking } from "@/lib/data-store/call-reports";
import { getFinancialsByInstitution } from "@/lib/data-store/financial";
import { HeroCards } from "./hero-cards";
import { repairHrefForQualitySignal } from "@/lib/institution-quality";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function InstitutionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth("view");
  const { id } = await params;
  const institutionId = Number(id);

  if (isNaN(institutionId)) notFound();

  const [
    institution,
    fees,
    feeScheduleEvidence,
    crawlHistory,
    agentResults,
    peerRanking,
    financials,
    learnedNotes,
  ] =
    await Promise.all([
      getInstitution(institutionId),
      getInstitutionFees(institutionId),
      getInstitutionFeeScheduleEvidence(institutionId),
      getInstitutionCrawlHistory(institutionId),
      getInstitutionAgentResults(institutionId),
      getInstitutionPeerRanking(institutionId),
      getFinancialsByInstitution(institutionId),
      getInstitutionLearnedNotes(institutionId),
    ]);

  if (!institution) notFound();

  const stateCode = institution.state_code ?? "??";

  return (
    <>
      {/* Header */}
      <div className="mb-5">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/admin" },
            { label: "States", href: "/admin/states" },
            { label: stateCode, href: `/admin/states/${stateCode}` },
            { label: institution.institution_name },
          ]}
        />
        <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          {institution.institution_name}
        </h1>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {[
            institution.city,
            stateCode,
            institution.charter_type,
            institution.asset_size_tier,
            institution.fed_district
              ? `District ${institution.fed_district}`
              : null,
          ]
            .filter(Boolean)
            .join(" / ")}
        </p>
      </div>

      {/* Profile + Actions row */}
      <div className="grid md:grid-cols-2 gap-4 mb-8">
        {/* Profile Card */}
        <div className="admin-card p-4">
          <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em] mb-3">
            Profile
          </h3>
          <dl className="space-y-2 text-xs">
            <ProfileRow label="Website">
              {institution.website_url ? (
                <a
                  href={institution.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline break-all"
                >
                  {truncateUrl(institution.website_url)}
                </a>
              ) : (
                <span className="text-gray-400">-</span>
              )}
            </ProfileRow>
            <ProfileRow label="Fee Schedule URL">
              {institution.fee_schedule_url ? (
                <a
                  href={institution.fee_schedule_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline break-all"
                >
                  {truncateUrl(institution.fee_schedule_url)}
                </a>
              ) : (
                <span className="text-gray-400">
                  {institution.document_type === "offline" ? "offline" : "none"}
                </span>
              )}
            </ProfileRow>
            <ProfileRow label="Document Type">
              {institution.document_type ? (
                <DocTypeBadge type={institution.document_type} />
              ) : (
                <span className="text-gray-400">-</span>
              )}
            </ProfileRow>
            <ProfileRow label="Quality">
              <div className="space-y-1">
                <QualityBadge signal={institution.quality_signals[0]} />
                <p className="max-w-md text-[11px] leading-snug text-gray-500 dark:text-gray-400">
                  {institution.quality_signals[0].detail}
                </p>
                <Link
                  href={repairHrefForQualitySignal(institution.quality_signals[0])}
                  className="inline-flex text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  Open repair lane
                </Link>
              </div>
            </ProfileRow>
            <ProfileRow label="Source">
              <span className="text-gray-700 dark:text-gray-300 uppercase">
                {institution.source ?? "-"}
              </span>
            </ProfileRow>
            <ProfileRow label="Cert Number">
              <span className="text-gray-700 dark:text-gray-300 tabular-nums">
                {institution.cert_number ?? "-"}
              </span>
            </ProfileRow>
            <ProfileRow label="RSSD / LEI">
              <span className="text-gray-700 dark:text-gray-300 tabular-nums">
                {institution.rssd_id ?? "-"} / {institution.lei ?? "-"}
              </span>
            </ProfileRow>
            <ProfileRow label="Asset Size">
              <span className="text-gray-700 dark:text-gray-300 tabular-nums">
                {institution.asset_size
                  ? formatAssets(institution.asset_size)
                  : "-"}
              </span>
            </ProfileRow>
            <ProfileRow label="Published Fees">
              <span className="text-gray-700 dark:text-gray-300 tabular-nums">
                {institution.published_fee_count.toLocaleString()}
              </span>
            </ProfileRow>
            <ProfileRow label="Latest Extracted">
              <span className="text-gray-700 dark:text-gray-300 tabular-nums">
                {institution.latest_extracted_fee_count.toLocaleString()}
                {institution.latest_source_status ? ` (${institution.latest_source_status})` : ""}
              </span>
            </ProfileRow>
            <ProfileRow label="Last Crawl">
              <span className="text-gray-700 dark:text-gray-300 tabular-nums">
                {institution.last_crawl_at}
              </span>
            </ProfileRow>
            <ProfileRow label="Consecutive Failures">
              <span
                className={`tabular-nums ${
                  institution.consecutive_failures > 0
                    ? "text-red-600 dark:text-red-400 font-medium"
                    : "text-gray-700 dark:text-gray-300"
                }`}
              >
                {institution.consecutive_failures}
              </span>
            </ProfileRow>
          </dl>
        </div>

        {/* Admin Actions */}
        <InstitutionActions
          institutionId={institution.id}
          institutionName={institution.institution_name}
          feeScheduleUrl={institution.fee_schedule_url}
          documentType={institution.document_type}
        />
      </div>

      {/* Financial Profile — Hero Cards */}
      <HeroCards financials={financials} peerRanking={peerRanking} />

      <FeeScheduleEvidencePanel
        institution={institution}
        evidence={feeScheduleEvidence}
      />

      {learnedNotes && <LearnedNotesPanel notes={learnedNotes} />}

      {/* Published Fees */}
      <div className="admin-card overflow-hidden mb-8">
        <div className="px-4 py-2.5 border-b border-gray-100 dark:border-white/[0.04]">
          <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em]">
            Published Fees ({fees.length})
          </h2>
        </div>
        {fees.length > 0 ? (
          <FeeTable fees={fees} />
        ) : (
          <div className="p-6 text-xs text-gray-400 text-center">
            No published fees yet. Set a fee schedule URL and run the agentic pipeline.
          </div>
        )}
      </div>

      {/* Agent History */}
      <div className="admin-card overflow-hidden mb-8">
        <div className="px-4 py-2.5 border-b border-gray-100 dark:border-white/[0.04]">
          <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em]">
            Agent History ({agentResults.length})
          </h2>
        </div>
        {agentResults.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="admin-table w-full text-xs">
              <thead>
                <tr className="text-left">
                  <th>Date</th>
                  <th>Stage</th>
                  <th className="text-center">Status</th>
                  <th>Detail</th>
                  <th className="text-center">Run</th>
                </tr>
              </thead>
              <tbody>
                {agentResults.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-gray-50/50 dark:hover:bg-white/[0.04] transition-colors"
                  >
                    <td className="text-gray-700 dark:text-gray-300 tabular-nums">
                      {r.run_started_at}
                    </td>
                    <td className="text-gray-700 dark:text-gray-300 capitalize">
                      {r.stage}
                    </td>
                    <td className="text-center">
                      <StageBadge status={r.status} />
                    </td>
                    <td className="text-gray-500 max-w-[240px] truncate">
                      {summarizeDetail(r.detail)}
                    </td>
                    <td className="text-center">
                      <Link
                        href={`/admin/states/${stateCode}/runs/${r.agent_run_id}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        #{r.agent_run_id}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-xs text-gray-400 text-center">
            No agent results yet
          </div>
        )}
      </div>

      {/* Source documents: every version we downloaded, our stored copy, and what each yielded */}
      <div className="admin-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 dark:border-white/[0.04]">
          <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em]">
            Source documents ({crawlHistory.length})
          </h2>
        </div>
        {crawlHistory.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="admin-table w-full text-xs">
              <thead>
                <tr className="text-left">
                  <th>Date</th>
                  <th className="text-center">Status</th>
                  <th>Version</th>
                  <th>Fee page?</th>
                  <th>Document URL</th>
                  <th>Our copy</th>
                  <th className="text-right">Fees</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {crawlHistory.map((cr) => (
                  <tr
                    key={cr.id}
                    className="hover:bg-gray-50/50 dark:hover:bg-white/[0.04] transition-colors"
                  >
                    <td className="text-gray-700 dark:text-gray-300 tabular-nums">
                      {cr.crawled_at}
                    </td>
                    <td className="text-center">
                      <CrawlStatusBadge status={cr.status} />
                    </td>
                    <td className="font-mono text-[11px] text-gray-500" title={cr.content_hash ?? undefined}>
                      {cr.content_hash ? cr.content_hash.slice(0, 8) : "-"}
                    </td>
                    <td>
                      <ReadStatusLabel status={cr.read_status} />
                    </td>
                    <td className="text-gray-500 max-w-[200px] truncate">
                      {cr.document_url ? (
                        <a
                          href={cr.document_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                          title={cr.document_url}
                        >
                          {truncateUrl(cr.document_url, 40)}
                        </a>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td>
                      {cr.stored ? (
                        <a
                          href={`/api/admin/documents/${cr.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {cr.knox_fees || cr.fees_extracted}
                    </td>
                    <td className="text-gray-500 max-w-[200px] truncate">
                      {cr.error_message || cr.read_note ? (
                        <span
                          className={cr.error_message ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}
                          title={cr.error_message ?? cr.read_note ?? undefined}
                        >
                          {truncate(cr.error_message ?? cr.read_note ?? "", 50)}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-xs text-gray-400 text-center">
            No crawl history
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function truncateUrl(url: string, maxLen = 50): string {
  try {
    const parsed = new URL(url);
    const display = parsed.hostname + parsed.pathname;
    return display.length > maxLen ? display.slice(0, maxLen) + "..." : display;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen) + "..." : url;
  }
}

function truncate(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function summarizeDetail(
  detail: Record<string, unknown> | null,
): string {
  if (!detail) return "-";
  const parts: string[] = [];
  if (detail.fee_count != null) parts.push(`${detail.fee_count} fees`);
  if (detail.data_quality != null) parts.push(`quality: ${detail.data_quality}`);
  if (detail.reason) parts.push(String(detail.reason));
  if (detail.error) parts.push(String(detail.error));
  if (detail.url) parts.push(truncate(String(detail.url), 30));
  return parts.length > 0 ? parts.join(", ") : "-";
}

function formatFeeAmount(amount: number | null): string {
  if (amount === null) return "varies";
  if (amount === 0) return "Free";
  return `$${amount.toFixed(2)}`;
}

function confidenceLabel(confidence: number | null): string {
  return confidence === null ? "-" : `${Math.round(confidence * 100)}%`;
}

function shortHash(hash: string | null): string {
  return hash ? hash.slice(0, 12) : "-";
}

function getPipelineRepairHref(
  evidence: InstitutionFeeScheduleEvidence,
): string {
  const counts = evidence.pipeline_counts;
  const latestDocument = evidence.latest_document;
  const latestText = evidence.latest_text;

  if (!latestDocument || latestDocument.status !== "success") {
    return "/admin/magellan";
  }
  if (!latestText || latestText.status !== "completed" || counts.raw_fee_count === 0) {
    return "/admin/knox";
  }
  if (counts.verified_fee_count === 0 || counts.raw_without_verified_count > 0) {
    return "/admin/darwin";
  }
  if (counts.verified_without_published_count > 0 || counts.published_fee_count === 0) {
    return "/admin/hamilton";
  }
  return "/admin/agents/lineage";
}

function getPipelineDiagnosis(
  institution: Institution,
  evidence: InstitutionFeeScheduleEvidence,
): string {
  const counts = evidence.pipeline_counts;
  const latestDocument = evidence.latest_document;
  const latestText = evidence.latest_text;

  if (counts.published_fee_count > 0) {
    return "Hamilton has published visible fee rows for this institution.";
  }
  if (!institution.fee_schedule_url) {
    return "No fee schedule URL is stored. Magellan needs to discover a source.";
  }
  if (!latestDocument) {
    return "A fee schedule URL is stored, but Magellan has not fetched a source document yet.";
  }
  if (latestDocument.status !== "success") {
    return "The latest Magellan source fetch failed, so no trustworthy fee rows are visible yet.";
  }
  if (!latestText) {
    return "Magellan fetched the source, but Rosetta has not produced text for Knox yet.";
  }
  if (latestText.status !== "completed") {
    return "Rosetta did not complete a usable text artifact, so Knox has no stable text to extract from.";
  }
  if (counts.raw_fee_count === 0) {
    return "Rosetta produced text, but Knox has not inserted raw fee observations.";
  }
  if (counts.verified_fee_count === 0) {
    return "Knox inserted raw fee observations, but Darwin has not verified them.";
  }
  if (counts.verified_without_published_count > 0) {
    return "Darwin verified fees that Hamilton has not published yet.";
  }
  return "No published fee rows are visible. Check the latest agent history for the blocking step.";
}

// ---------------------------------------------------------------------------
// Helper Components
// ---------------------------------------------------------------------------

function FeeScheduleEvidencePanel({
  institution,
  evidence,
}: {
  institution: Institution;
  evidence: InstitutionFeeScheduleEvidence;
}) {
  const counts = evidence.pipeline_counts;
  const latestDocument = evidence.latest_document;
  const latestText = evidence.latest_text;
  const repairHref = getPipelineRepairHref(evidence);
  const hasPublishedFees = counts.published_fee_count > 0;

  return (
    <div className="admin-card overflow-hidden mb-8">
      <div className="flex flex-col gap-2 border-b border-gray-100 px-4 py-3 dark:border-white/[0.04] md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-gray-400">
            Fee Schedule Evidence
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-gray-600 dark:text-gray-300">
            {getPipelineDiagnosis(institution, evidence)}
          </p>
        </div>
        <Link
          href={repairHref}
          className="inline-flex shrink-0 items-center justify-center rounded-md border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-700 hover:border-blue-200 hover:text-blue-700 dark:border-white/[0.08] dark:text-gray-300 dark:hover:border-blue-900/60 dark:hover:text-blue-300"
        >
          Open pipeline lane
        </Link>
      </div>

      <div className="grid gap-px bg-gray-100 dark:bg-white/[0.04] sm:grid-cols-2 lg:grid-cols-5">
        <EvidenceMetric
          label="Stored URL"
          value={institution.fee_schedule_url ? "Yes" : "No"}
          tone={institution.fee_schedule_url ? "ok" : "warn"}
        />
        <EvidenceMetric
          label="Latest Source"
          value={latestDocument?.status ?? "None"}
          tone={latestDocument?.status === "success" ? "ok" : "warn"}
        />
        <EvidenceMetric
          label="Knox Raw"
          value={counts.raw_fee_count.toLocaleString()}
          tone={counts.raw_fee_count > 0 ? "ok" : "warn"}
        />
        <EvidenceMetric
          label="Darwin Verified"
          value={counts.verified_fee_count.toLocaleString()}
          tone={counts.verified_fee_count > 0 ? "ok" : "warn"}
        />
        <EvidenceMetric
          label="Hamilton Published"
          value={counts.published_fee_count.toLocaleString()}
          tone={hasPublishedFees ? "ok" : "warn"}
        />
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-3">
        <section className="rounded-md border border-gray-100 p-3 dark:border-white/[0.06]">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400">
            Stored Schedule
          </h3>
          <div className="mt-2 space-y-2 text-xs">
            {institution.fee_schedule_url ? (
              <a
                href={institution.fee_schedule_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex font-semibold text-blue-600 hover:underline dark:text-blue-400"
              >
                Open stored URL
              </a>
            ) : (
              <p className="text-gray-500 dark:text-gray-400">No URL stored.</p>
            )}
            <dl className="space-y-1">
              <EvidenceRow label="Document Type">
                {institution.document_type ? (
                  <DocTypeBadge type={institution.document_type} />
                ) : (
                  <span className="text-gray-400">-</span>
                )}
              </EvidenceRow>
              <EvidenceRow label="Quality">
                <QualityBadge signal={institution.quality_signals[0]} />
              </EvidenceRow>
            </dl>
          </div>
        </section>

        <section className="rounded-md border border-gray-100 p-3 dark:border-white/[0.06]">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400">
            Latest Source Document
          </h3>
          {latestDocument ? (
            <dl className="mt-2 space-y-1 text-xs">
              <EvidenceRow label="Status">
                <CrawlStatusBadge status={latestDocument.status} />
              </EvidenceRow>
              <EvidenceRow label="Document">
                {latestDocument.document_url ? (
                  <a
                    href={latestDocument.document_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline dark:text-blue-400"
                    title={latestDocument.document_url}
                  >
                    #{latestDocument.id} {truncateUrl(latestDocument.document_url, 42)}
                  </a>
                ) : (
                  <span className="text-gray-400">#{latestDocument.id}</span>
                )}
              </EvidenceRow>
              <EvidenceRow label="Fetched">{latestDocument.crawled_at}</EvidenceRow>
              <EvidenceRow label="HTTP">{latestDocument.status_code ?? "-"}</EvidenceRow>
              <EvidenceRow label="Fees Extracted">
                {latestDocument.fees_extracted.toLocaleString()}
              </EvidenceRow>
              <EvidenceRow label="Hash">{shortHash(latestDocument.content_hash)}</EvidenceRow>
              {latestDocument.error_message && (
                <EvidenceRow label="Error">
                  <span
                    className="text-red-600 dark:text-red-400"
                    title={latestDocument.error_message}
                  >
                    {truncate(latestDocument.error_message, 90)}
                  </span>
                </EvidenceRow>
              )}
            </dl>
          ) : (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              No source document has been fetched yet.
            </p>
          )}
        </section>

        <section className="rounded-md border border-gray-100 p-3 dark:border-white/[0.06]">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400">
            Latest Text Artifact
          </h3>
          {latestText ? (
            <div className="mt-2 space-y-2 text-xs">
              <dl className="space-y-1">
                <EvidenceRow label="Status">
                  <StageBadge status={latestText.status} />
                </EvidenceRow>
                <EvidenceRow label="Artifact">#{latestText.id}</EvidenceRow>
                <EvidenceRow label="Source Doc">#{latestText.source_document_id}</EvidenceRow>
                <EvidenceRow label="Chars">
                  {latestText.char_count.toLocaleString()}
                </EvidenceRow>
                <EvidenceRow label="Updated">{latestText.updated_at}</EvidenceRow>
              </dl>
              {latestText.text_excerpt && (
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-[11px] leading-snug text-gray-600 dark:bg-white/[0.03] dark:text-gray-300">
                  {latestText.text_excerpt}
                </pre>
              )}
              {latestText.error_message && (
                <p className="text-red-600 dark:text-red-400">
                  {truncate(latestText.error_message, 110)}
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              No text artifact is available for extraction yet.
            </p>
          )}
        </section>
      </div>

      {(counts.raw_without_verified_count > 0 ||
        counts.verified_without_published_count > 0) && (
        <div className="border-t border-gray-100 px-4 py-3 text-xs text-amber-700 dark:border-white/[0.04] dark:text-amber-300">
          {counts.raw_without_verified_count > 0 && (
            <span className="mr-4">
              {counts.raw_without_verified_count.toLocaleString()} raw rows are not Darwin
              verified.
            </span>
          )}
          {counts.verified_without_published_count > 0 && (
            <span>
              {counts.verified_without_published_count.toLocaleString()} verified rows are
              not Hamilton published.
            </span>
          )}
        </div>
      )}

      <div className="grid gap-4 border-t border-gray-100 p-4 dark:border-white/[0.04] xl:grid-cols-2">
        <RawFeePreviewTable rows={evidence.raw_fee_preview} />
        <VerifiedFeePreviewTable rows={evidence.verified_fee_preview} />
      </div>
    </div>
  );
}

function EvidenceMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn";
}) {
  const valueClass =
    tone === "ok"
      ? "text-gray-900 dark:text-gray-100"
      : "text-amber-700 dark:text-amber-300";
  return (
    <div className="bg-white px-4 py-3 dark:bg-gray-950">
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
    </div>
  );
}

function EvidenceRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-24 shrink-0 text-gray-400">{label}</dt>
      <dd className="min-w-0 text-gray-700 dark:text-gray-300">{children}</dd>
    </div>
  );
}

function RawFeePreviewTable({
  rows,
}: {
  rows: InstitutionFeeScheduleEvidence["raw_fee_preview"];
}) {
  return (
    <section className="overflow-hidden rounded-md border border-gray-100 dark:border-white/[0.06]">
      <div className="border-b border-gray-100 px-3 py-2 dark:border-white/[0.04]">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400">
          Knox Raw Preview ({rows.length})
        </h3>
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="admin-table w-full text-xs">
            <thead>
              <tr className="text-left">
                <th>Raw</th>
                <th>Fee</th>
                <th className="text-right">Amount</th>
                <th>Frequency</th>
                <th className="text-center">Conf.</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((fee) => (
                <tr key={fee.fee_raw_id}>
                  <td className="tabular-nums text-gray-500">#{fee.fee_raw_id}</td>
                  <td className="max-w-[280px] text-gray-900 dark:text-gray-100">
                    <span className="font-medium">{fee.fee_name}</span>
                    {fee.conditions && (
                      <p className="mt-0.5 truncate text-[11px] text-gray-500">
                        {fee.conditions}
                      </p>
                    )}
                  </td>
                  <td className="text-right tabular-nums font-medium text-gray-900 dark:text-gray-100">
                    {formatFeeAmount(fee.amount)}
                  </td>
                  <td className="text-gray-500">{fee.frequency ?? "-"}</td>
                  <td className="text-center tabular-nums text-gray-400">
                    {confidenceLabel(fee.extraction_confidence)}
                  </td>
                  <td>
                    {fee.source_url ? (
                      <a
                        href={fee.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-4 text-center text-xs text-gray-400">
          No Knox raw fees found.
        </div>
      )}
    </section>
  );
}

function VerifiedFeePreviewTable({
  rows,
}: {
  rows: InstitutionFeeScheduleEvidence["verified_fee_preview"];
}) {
  return (
    <section className="overflow-hidden rounded-md border border-gray-100 dark:border-white/[0.06]">
      <div className="border-b border-gray-100 px-3 py-2 dark:border-white/[0.04]">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400">
          Darwin Verified Preview ({rows.length})
        </h3>
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="admin-table w-full text-xs">
            <thead>
              <tr className="text-left">
                <th>Verified</th>
                <th>Canonical</th>
                <th>Fee</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((fee) => (
                <tr key={fee.fee_verified_id}>
                  <td className="tabular-nums text-gray-500">
                    #{fee.fee_verified_id}
                  </td>
                  <td className="text-gray-500">
                    {fee.canonical_fee_key.replace(/_/g, " ")}
                  </td>
                  <td className="max-w-[260px] font-medium text-gray-900 dark:text-gray-100">
                    {fee.fee_name}
                  </td>
                  <td className="text-right tabular-nums font-medium text-gray-900 dark:text-gray-100">
                    {formatFeeAmount(fee.amount)}
                  </td>
                  <td>
                    <StageBadge status={fee.review_status} />
                  </td>
                  <td>
                    {fee.source_url ? (
                      <a
                        href={fee.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-4 text-center text-xs text-gray-400">
          No Darwin verified fees found.
        </div>
      )}
    </section>
  );
}

function LearnedNotesPanel({ notes }: { notes: InstitutionLearnedNotes }) {
  return (
    <div className="admin-card overflow-hidden mb-8">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-white/[0.04]">
        <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em]">
          What the pipeline has learned
        </h2>
        <span className="text-[11px] text-gray-400 tabular-nums">
          {notes.formatLabel ?? "Document type unknown"}
          {notes.lastLearnedAt ? ` · updated ${notes.lastLearnedAt}` : ""}
        </span>
      </div>
      <div className="p-4 text-xs text-gray-700 dark:text-gray-300 space-y-1.5">
        {notes.nextStep && (
          <p className="font-medium text-amber-700 dark:text-amber-400">{notes.nextStep}</p>
        )}
        <ul className="list-disc pl-4 space-y-1">
          {notes.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ProfileRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <dt className="text-gray-400 w-36 shrink-0">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function DocTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    pdf: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    html: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    js_rendered:
      "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    offline:
      "bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400",
  };
  const cls =
    styles[type] ??
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${cls}`}
    >
      {type}
    </span>
  );
}

function QualityBadge({
  signal,
}: {
  signal: { severity: string; label: string };
}) {
  const styles: Record<string, string> = {
    critical:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/25 dark:text-red-300",
    warning:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-300",
    info:
      "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/25 dark:text-blue-300",
    ok:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/25 dark:text-emerald-300",
  };
  return (
    <span
      className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold ${styles[signal.severity] ?? styles.info}`}
    >
      {signal.label}
    </span>
  );
}

function StageBadge({ status }: { status: string }) {
  const isOk =
    status === "ok" || status === "success" || status === "completed";
  if (isOk) {
    return (
      <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        {status}
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
        skipped
      </span>
    );
  }
  return (
    <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400">
      {status}
    </span>
  );
}

function CrawlStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    success:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    ok: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    failed:
      "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    error:
      "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  const cls =
    styles[status] ??
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${cls}`}
    >
      {status}
    </span>
  );
}

function ReadStatusLabel({ status }: { status: string | null }) {
  if (!status) return <span className="text-gray-400">not read</span>;
  const label: Record<string, { text: string; tone: string }> = {
    completed: { text: "Yes", tone: "text-emerald-700 dark:text-emerald-400" },
    wrong_document: { text: "No, wrong page", tone: "text-red-600 dark:text-red-400" },
    needs_ocr: { text: "Scan (needs OCR)", tone: "text-amber-700 dark:text-amber-400" },
    empty: { text: "Empty page", tone: "text-amber-700 dark:text-amber-400" },
    failed: { text: "Read failed", tone: "text-red-600 dark:text-red-400" },
  };
  const entry = label[status] ?? { text: status, tone: "text-gray-500" };
  return <span className={`text-[11px] font-medium ${entry.tone}`}>{entry.text}</span>;
}

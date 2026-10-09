export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireAuth } from "@/lib/auth";
import {
  checkFeeAgainstSource,
  checkRateAgainstSource,
  linesNamingFee,
  type SourceCheckFailure,
} from "@/lib/custom-report/source-check";
import { getKnoxRejectionById, type KnoxRejectionDetail } from "@/lib/data-store/knox-reviews";
import {
  describeFeeAmount,
  interpretKnoxReasons,
  knoxReviewActionsExplanation,
  KNOX_REASON_GROUP_LABELS,
} from "@/lib/knox-reasons";
import { ratePercentOf } from "@/lib/percent-fees";
import {
  ConfirmButton,
  OverrideButton,
} from "../review-actions";
import { buildAdminRedirectPath, type AdminSearchParams } from "@/lib/admin-redirect-path";

const SOURCE_CHECK_WORDS: Record<SourceCheckFailure, string> = {
  no_source_text: "the stored text is empty",
  name_not_in_text: "no line names this fee",
  amount_not_the_fee: "a line names the fee, but the amount there is not its price",
  priced_per_amount: "the line prices it per amount, not as one fee",
  amount_is_a_threshold: "the amount on the line is a limit or balance, not the fee",
  tiered_fee: "the line states tiers that depend on a balance",
  category_not_in_text: "the line lacks wording for the fee's category",
};

function confidenceBadge(conf: number | null) {
  if (conf === null || conf === undefined) return <span className="text-sm text-gray-500">Not recorded</span>;
  const pct = Math.round(Number(conf) * 100);
  const cls =
    conf >= 0.9
      ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
      : conf >= 0.7
        ? "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
        : "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${cls}`}>
      {pct}%
    </span>
  );
}

function day(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

type Evidence =
  | { kind: "matched"; line: string }
  | { kind: "named"; why: string; lines: string[] }
  | { kind: "not_found"; why: string }
  | { kind: "no_text" };

/** Where the fee sits in its stored source text, using the shared source check. */
function sourceEvidence(detail: KnoxRejectionDetail): Evidence {
  const text = detail.source_text;
  if (!text || !text.trim()) return { kind: "no_text" };
  const feeName = detail.fee_raw_name ?? detail.fee_name ?? "";
  const rate = ratePercentOf(detail);
  const amount = detail.amount == null ? null : Number(detail.amount);
  const check =
    rate != null
      ? checkRateAgainstSource(text, feeName, rate, ".")
      : amount != null && Number.isFinite(amount)
        ? checkFeeAgainstSource(text, feeName, amount, ".", detail.canonical_fee_key)
        : null;
  if (check?.ok) return { kind: "matched", line: check.sourceLine };
  const why = check ? SOURCE_CHECK_WORDS[check.reason] : "no amount is recorded to check";
  const lines = linesNamingFee(text, feeName);
  return lines.length > 0 ? { kind: "named", why, lines } : { kind: "not_found", why: "no line of the stored text names this fee" };
}

const LABEL = "text-[10px] font-semibold text-gray-400 uppercase tracking-wider";

export async function KnoxDecisionDetailView({ id }: { id: string }) {
  const user = await requireAuth("view");
  const detail = await getKnoxRejectionById(id);

  if (!detail) {
    return (
      <div className="admin-card p-8">
        <p className="text-gray-500">
          Rejection {id} not found or is not a Knox rejection.
        </p>
        <Link
          href="/admin/knox?queue=decisions"
          className="mt-3 inline-block text-sm text-blue-600 hover:underline"
        >
          Back to queue
        </Link>
      </div>
    );
  }

  const canAct =
    (user.role === "analyst" || user.role === "admin") &&
    detail.review_decision === null;

  const amount = describeFeeAmount({ ...detail, conditions: detail.fee_raw_conditions });
  const reasons = interpretKnoxReasons(detail.payload, { amountRecorded: amount.kind !== "unknown" });
  const blocking = reasons.filter((r) => r.blocking);
  const context = reasons.filter((r) => !r.blocking);
  const documentUrl = detail.document_url ?? detail.raw_source_url ?? detail.source_url;
  const evidence = sourceEvidence(detail);
  const regulatorIds = [
    detail.institution_cert_number && detail.institution_charter_type !== "credit_union"
      ? `FDIC cert ${detail.institution_cert_number}`
      : null,
    detail.institution_ncua_charter_id ? `NCUA charter ${detail.institution_ncua_charter_id}` : null,
    detail.institution_rssd_id ? `RSSD ${detail.institution_rssd_id}` : null,
  ].filter(Boolean);
  const queueHref = `/admin/knox?queue=decisions&reason=${detail.reason_group}`;

  return (
    <>
      <div className="mb-6">
        <Breadcrumbs
          items={[
            { label: "Atlas", href: "/admin" },
            { label: "Knox", href: "/admin/knox?queue=decisions" },
            { label: id.slice(0, 8) },
          ]}
        />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {detail.fee_name ?? "(unknown fee)"}
          </h1>
          <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400">
            Knox rejected
          </span>
          {detail.review_decision && (
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                detail.review_decision === "override"
                  ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400"
              }`}
            >
              Human {detail.review_decision}
              {detail.reviewer_username ? ` by ${detail.reviewer_username}` : ""}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 mt-0.5">
          {detail.institution_name ?? "-"}
          {detail.state_code ? ` · ${detail.state_code}` : ""}
          {" · "}
          <span className="tabular-nums">
            {new Date(detail.created_at).toLocaleString()}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="admin-card">
          <div className="px-5 py-3 border-b bg-red-50/60 dark:bg-red-900/10">
            <h2 className="text-sm font-bold text-red-700 dark:text-red-400">
              Why Knox rejected it
            </h2>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <div className={LABEL}>Reason group</div>
              <Link
                href={queueHref}
                className="mt-1 inline-block rounded-full px-2 py-0.5 bg-gray-100 dark:bg-white/[0.06] text-gray-700 dark:text-gray-300 text-[11px] font-medium hover:underline"
              >
                {KNOX_REASON_GROUP_LABELS[detail.reason_group]}
              </Link>
            </div>
            <div>
              <div className={LABEL}>Rejection reasons</div>
              {blocking.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">No rejection reason is stored on this verdict.</p>
              ) : (
                <ul className="mt-1 space-y-2">
                  {blocking.map((r, index) => (
                    <li key={index} className="text-sm text-gray-800 dark:text-gray-200">
                      <span className="font-medium">{r.label}.</span> {r.detail}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {context.length > 0 && (
              <div>
                <div className={LABEL}>Other checks</div>
                <ul className="mt-1 space-y-1">
                  {context.map((r, index) => (
                    <li key={index} className="text-xs text-gray-500 dark:text-gray-400">
                      {r.label}: {r.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className={LABEL}>Knox confidence</div>
                <div className="mt-1">
                  {confidenceBadge(detail.confidence !== null ? Number(detail.confidence) : null)}
                </div>
              </div>
              <div>
                <div className={LABEL}>Round</div>
                <div className="mt-1 text-sm tabular-nums text-gray-800 dark:text-gray-200">
                  {detail.round_number}
                </div>
              </div>
            </div>
            <details>
              <summary className={`${LABEL} cursor-pointer`}>Stored payload</summary>
              <pre className="mt-1 rounded bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/[0.06] p-3 text-[11px] text-gray-700 dark:text-gray-300 overflow-x-auto tabular-nums">
{JSON.stringify(detail.payload, null, 2)}
              </pre>
            </details>
          </div>
        </div>

        <div className="admin-card">
          <div className="px-5 py-3 border-b bg-gray-50/80 dark:bg-white/[0.03]">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">
              What the fee looks like
            </h2>
          </div>
          <div className="p-5">
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className={LABEL}>Fee name</dt>
                <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                  {detail.fee_name ?? "-"}
                </dd>
              </div>
              <div>
                <dt className={LABEL}>Amount</dt>
                <dd className="mt-1 text-sm tabular-nums text-gray-900 dark:text-gray-100">
                  {amount.label}
                </dd>
                {amount.note && <dd className="mt-0.5 text-[11px] text-gray-500">{amount.note}</dd>}
              </div>
              <div>
                <dt className={LABEL}>Frequency</dt>
                <dd className="mt-1 text-sm text-gray-800 dark:text-gray-200">
                  {detail.frequency ?? "-"}
                </dd>
              </div>
              <div>
                <dt className={LABEL}>Extraction confidence</dt>
                <dd className="mt-1">
                  {confidenceBadge(
                    detail.extraction_confidence !== null
                      ? Number(detail.extraction_confidence)
                      : null
                  )}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className={LABEL}>Canonical fee key</dt>
                <dd className="mt-1 text-sm font-mono text-gray-800 dark:text-gray-200">
                  {detail.canonical_fee_key ?? "-"}
                </dd>
              </div>
              {detail.variant_type && (
                <div className="col-span-2">
                  <dt className={LABEL}>Variant</dt>
                  <dd className="mt-1 text-sm text-gray-800 dark:text-gray-200">
                    {detail.variant_type}
                  </dd>
                </div>
              )}
              {detail.fee_raw_conditions && (
                <div className="col-span-2">
                  <dt className={LABEL}>Raw conditions</dt>
                  <dd className="mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {detail.fee_raw_conditions}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="admin-card">
          <div className="px-5 py-3 border-b bg-gray-50/80 dark:bg-white/[0.03]">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">Source evidence</h2>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <div className={LABEL}>Document</div>
              {documentUrl ? (
                <a
                  href={documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-sm text-blue-600 hover:underline break-all"
                >
                  {documentUrl}
                </a>
              ) : (
                <p className="mt-1 text-sm text-gray-500">No source document or URL is linked to this fee.</p>
              )}
              {detail.source_document_id != null && (
                <p className="mt-0.5 text-[11px] text-gray-500 tabular-nums">
                  Document #{detail.source_document_id}
                  {detail.source_text_document_type ? ` · ${detail.source_text_document_type}` : detail.document_content_type ? ` · ${detail.document_content_type}` : ""}
                  {day(detail.document_crawled_at) ? ` · fetched ${day(detail.document_crawled_at)}` : ""}
                  {detail.source_text_char_count != null ? ` · ${detail.source_text_char_count.toLocaleString("en-US")} characters of text` : ""}
                </p>
              )}
            </div>
            <div>
              <div className={LABEL}>Excerpt</div>
              {evidence.kind === "matched" && (
                <>
                  <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                    The source check finds this fee and amount on this line:
                  </p>
                  <blockquote className="mt-1 rounded border border-gray-100 dark:border-white/[0.06] bg-gray-50 dark:bg-white/[0.03] p-3 text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                    {evidence.line}
                  </blockquote>
                </>
              )}
              {evidence.kind === "named" && (
                <>
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                    The source check does not confirm the amount ({evidence.why}). Lines naming the fee:
                  </p>
                  {evidence.lines.map((line, index) => (
                    <blockquote
                      key={index}
                      className="mt-1 rounded border border-gray-100 dark:border-white/[0.06] bg-gray-50 dark:bg-white/[0.03] p-3 text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap"
                    >
                      {line}
                    </blockquote>
                  ))}
                </>
              )}
              {evidence.kind === "not_found" && (
                <p className="mt-1 text-sm text-gray-500">Stored text found, but {evidence.why}.</p>
              )}
              {evidence.kind === "no_text" && (
                <p className="mt-1 text-sm text-gray-500">
                  {detail.source_document_id != null
                    ? "No stored text for this document."
                    : "No stored text: the raw observation is not linked to a source document."}
                </p>
              )}
              <p className="mt-1 text-[11px] text-gray-400">Page numbers are not stored with source text.</p>
            </div>
          </div>
        </div>

        <div className="admin-card">
          <div className="px-5 py-3 border-b bg-gray-50/80 dark:bg-white/[0.03]">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">Institution and lineage</h2>
          </div>
          <div className="p-5">
            <dl className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <dt className={LABEL}>Institution</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                  {detail.institution_id != null ? (
                    <Link href={`/admin/institution/${detail.institution_id}`} className="font-medium hover:underline">
                      {detail.institution_name ?? `Institution #${detail.institution_id}`}
                    </Link>
                  ) : (
                    "-"
                  )}
                  {[detail.institution_city, detail.state_code].filter(Boolean).length > 0 && (
                    <span className="text-gray-500"> · {[detail.institution_city, detail.state_code].filter(Boolean).join(", ")}</span>
                  )}
                  {detail.institution_charter_type && (
                    <span className="text-gray-500"> · {detail.institution_charter_type.replace(/_/g, " ")}</span>
                  )}
                </dd>
                {detail.institution_website_url && (
                  <dd className="mt-0.5">
                    <a
                      href={detail.institution_website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline break-all"
                    >
                      {detail.institution_website_url}
                    </a>
                  </dd>
                )}
                <dd className="mt-0.5 text-[11px] text-gray-500 tabular-nums">
                  {regulatorIds.length > 0 ? regulatorIds.join(" · ") : "No regulator ID stored"}
                </dd>
              </div>
              <div>
                <dt className={LABEL}>Raw observation</dt>
                <dd className="mt-1 text-xs text-gray-800 dark:text-gray-200 tabular-nums">
                  {detail.fee_raw_id != null ? `#${detail.fee_raw_id}` : "-"}
                  {day(detail.raw_created_at) ? ` · ${day(detail.raw_created_at)}` : ""}
                </dd>
                <dd className="mt-0.5 text-[11px] text-gray-500">
                  {[detail.raw_source, [detail.raw_event_agent, detail.raw_event_action].filter(Boolean).join(" ")]
                    .filter(Boolean)
                    .join(" · ") || "No extraction event recorded"}
                </dd>
              </div>
              <div>
                <dt className={LABEL}>Verified observation</dt>
                <dd className="mt-1 text-xs text-gray-800 dark:text-gray-200 tabular-nums">
                  {detail.fee_verified_id != null ? `#${detail.fee_verified_id}` : "-"}
                  {day(detail.verified_at) ? ` · ${day(detail.verified_at)}` : ""}
                </dd>
                <dd className="mt-0.5 text-[11px] text-gray-500">
                  {[detail.review_status, [detail.verified_event_agent, detail.verified_event_tool].filter(Boolean).join(" ")]
                    .filter(Boolean)
                    .join(" · ") || "No verification event recorded"}
                </dd>
              </div>
              <div>
                <dt className={LABEL}>Darwin accept</dt>
                <dd className="mt-1 text-xs text-gray-800 dark:text-gray-200 tabular-nums">
                  {day(detail.darwin_accept_at) ?? "None"}
                </dd>
              </div>
              <div>
                <dt className={LABEL}>Published</dt>
                <dd className="mt-1 text-xs text-gray-800 dark:text-gray-200 tabular-nums">
                  {detail.live_fee_published_id != null
                    ? `Live as record #${detail.live_fee_published_id}`
                    : "Not live"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="admin-card">
        <div className="px-5 py-3 border-b bg-gray-50/80 dark:bg-white/[0.03]">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">
            Reviewer actions
          </h2>
        </div>
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            {canAct ? (
              <>
                <ConfirmButton
                  messageId={detail.message_id}
                  feeVerifiedId={detail.fee_verified_id}
                />
                <OverrideButton
                  messageId={detail.message_id}
                  feeVerifiedId={detail.fee_verified_id}
                />
                <Link
                  href={queueHref}
                  className="rounded px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.12] transition-colors"
                >
                  Skip / Back to queue
                </Link>
              </>
            ) : (
              <p className="text-sm text-gray-500">
                {detail.review_decision
                  ? `Reviewed ${detail.review_decision} by ${detail.reviewer_username ?? "unknown"} at ${detail.reviewed_at ? new Date(detail.reviewed_at).toLocaleString() : "?"}.`
                  : "You do not have permission to act on this rejection."}
                {detail.review_note ? ` Note: ${detail.review_note}` : ""}
                {detail.review_decision === "override"
                  ? detail.promoted_fee_published_id != null
                    ? ` Published as record #${detail.promoted_fee_published_id}.`
                    : " The override did not publish the fee."
                  : ""}
              </p>
            )}
          </div>
          {canAct && (
            <p className="mt-3 text-[11px] text-gray-500">
              {knoxReviewActionsExplanation(detail.darwin_accept_at)}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

export default async function RedirectKnoxDecisionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<AdminSearchParams>;
}) {
  const { id } = await params;
  redirect(
    buildAdminRedirectPath(
      `/admin/knox/decisions/${encodeURIComponent(id)}`,
      await searchParams,
    ),
  );
}

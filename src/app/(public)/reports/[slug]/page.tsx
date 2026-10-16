/**
 * /reports/[slug] — ISR-cached report landing page.
 * Publicly: title, type, date and a pointer to the PDF. Not indexed until reports carry
 * a written summary on the page.
 * Full PDF download behind email gate (no login required).
 *
 * OG metadata per D-06/D-07: og:type=article, article:published_time, article:author.
 * artifact_key is NEVER passed to the client — only boolean artifactExists (T-16-06).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSql } from "@/lib/data-store/connection";
import type { ReportType } from "@/lib/report-engine/types";
import { EmailGate } from "./email-gate";
import { RESEARCH_IMPRINT, SITE_NAME, SITE_URL } from "@/lib/constants";
import { TrackLink } from "@/components/track-link";
import { PAGE_CRUMBS, PAGE_H1, PAGE_HEADER } from "@/components/public/page-header";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";

export const revalidate = 3600;

// Static params: return empty — pages generated on first visit, cached via ISR
export async function generateStaticParams() {
  return [];
}

// Human-readable labels for report types
const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  national_index: "National Index",
  state_index: "State Index",
  peer_brief: "Peer Brief",
  monthly_pulse: "Monthly Pulse",
};

function humanType(reportType: string): string {
  return REPORT_TYPE_LABELS[reportType as ReportType] ?? reportType;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Row returned by the JOIN query
interface ReportRow {
  id: string;
  job_id: string;
  report_type: string;
  slug: string;
  title: string;
  published_at: string;
  is_public: boolean;
  artifact_key: string | null;
  // data_manifest is JSONB — not passed to client
}

async function fetchReport(slug: string): Promise<ReportRow | null> {
  try {
    const sql = getSql();
    const rows = await sql<ReportRow[]>`
      SELECT
        pr.id,
        pr.job_id,
        pr.report_type,
        pr.slug,
        pr.title,
        pr.published_at,
        pr.is_public,
        rj.artifact_key
      FROM published_reports pr
      JOIN report_jobs rj ON pr.job_id = rj.id
      WHERE pr.slug = ${slug}
        AND pr.is_public = true
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// generateMetadata — called server-side for every request
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const report = await fetchReport(slug);

  if (!report) {
    return { title: "Report Not Found" };
  }

  const typeLabel = humanType(report.report_type);
  const description = `${typeLabel} published ${formatDate(report.published_at)} by ${RESEARCH_IMPRINT}.`;

  return {
    title: `${report.title}`,
    description,
    // No on-page summary yet, so this page adds nothing a search result should land on.
    robots: { index: false, follow: true },
    alternates: {
      canonical: `${SITE_URL}/reports/${slug}`,
    },
    openGraph: {
      title: report.title,
      description: `${typeLabel} — ${RESEARCH_IMPRINT}`,
      url: `${SITE_URL}/reports/${slug}`,
      siteName: SITE_NAME,
      type: "article",
      publishedTime: report.published_at,
      authors: [RESEARCH_IMPRINT],
    },
  };
}

// Page component
export default async function ReportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const report = await fetchReport(slug);

  if (!report) {
    notFound();
  }

  // artifact_key is used only to derive this boolean — never passed to client (T-16-06)
  const artifactExists = !!report.artifact_key;
  const typeLabel = humanType(report.report_type);

  return (
    <div className="pb-20">
      <section className="border-b border-border bg-paper">
        <div className="mx-auto grid max-w-page gap-x-12 gap-y-8 px-4 pb-12 pt-6 sm:px-6 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-center">
          <div className={PAGE_HEADER}>
            <nav aria-label="Breadcrumb" className={PAGE_CRUMBS}>
              <Link href="/reports" className="hover:text-ink">Reports</Link>
              <span aria-hidden="true">/</span>
              <span className="text-ink-soft">{typeLabel}</span>
            </nav>
            <h1 className={`mt-4 ${PAGE_H1}`}>{report.title}</h1>
            <p className="mt-3 text-[14px] text-ink-muted">
              {RESEARCH_IMPRINT} · Published {formatDate(report.published_at)}
            </p>
            <ReportCoverArt title={report.title} typeLabel={typeLabel} published={formatDate(report.published_at)} />
          </div>
          <div className="rounded-2xl border border-border bg-surface-0 p-5 shadow-fi-2 sm:p-6">
            <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">Get the full PDF</h2>
            <p className="mt-1 mb-4 text-[14px] text-ink-muted">Free. Every figure in it has a source.</p>
            <EmailGate slug={slug} artifactExists={artifactExists} />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-page px-4 pt-12 sm:px-6">
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface-0 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-ink">Want your own institution in it?</h2>
            <p className="mt-1 max-w-[36rem] text-[14px] text-ink-muted">
              Hamilton sets your fees against the competitors you choose and updates when their published schedules change.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <TrackLink
              event="upgrade_click"
              eventProps={{ placement: "published_report" }}
              href={PRO_PLANS_NAV.href}
              className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
            >
              {PRO_PLANS_NAV.label}
            </TrackLink>
            <Link href={DEMO_REQUEST_NAV.href} className="text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
              {DEMO_REQUEST_NAV.label}
            </Link>
          </div>
        </div>
        <p className="mt-6 text-[12px] text-ink-muted">
          Read from banks&apos; and credit unions&apos; own published fee schedules.{" "}
          <Link href="/methodology" className="underline decoration-border underline-offset-2 hover:text-ink">
            How we verify
          </Link>
        </p>
      </section>
    </div>
  );
}

/** The report's cover, drawn: its type, title and date on stacked pages, so the page shows what arrives. */
function ReportCoverArt({ title, typeLabel, published }: { title: string; typeLabel: string; published: string }) {
  return (
    <div className="relative mx-auto mt-8 w-full max-w-[26rem] py-4 text-left lg:mx-0" aria-hidden="true">
      <div className="absolute inset-x-6 inset-y-2 -rotate-3 rounded-xl bg-brick-tint" />
      <div className="absolute inset-x-4 inset-y-3 rotate-2 rounded-xl bg-surface-200" />
      <div className="relative rounded-xl border border-border bg-surface-0 p-6 shadow-fi-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brick">{typeLabel}</p>
        <p className="mt-3 text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</p>
        <div className="mt-6 space-y-2.5">
          {[62, 78, 48, 70].map((w, i) => (
            <span key={i} className="relative block h-2 rounded-full bg-paper">
              <span className="absolute inset-y-0 left-[18%] rounded-full bg-brick-tint" style={{ width: `${w - 18}%` }} />
              <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" style={{ left: `${w - 8}%` }} />
            </span>
          ))}
        </div>
        <p className="mt-6 text-[11px] text-ink-muted">{RESEARCH_IMPRINT} · {published}</p>
      </div>
    </div>
  );
}

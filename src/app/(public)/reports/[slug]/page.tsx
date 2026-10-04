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
    <div>
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "64px 24px 96px" }}>

        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" style={{ marginBottom: "32px", fontSize: "13px", color: "#6B6255" }}>
          <Link href="/reports" style={{ color: "#5A5347", textDecoration: "none" }}>
            Research Reports
          </Link>
          <span style={{ margin: "0 8px" }}>/</span>
          <span style={{ color: "#1A1815" }}>{report.title}</span>
        </nav>

        {/* Header */}
        <div style={{
          borderBottom: "2px solid #1A1815",
          paddingBottom: "24px",
          marginBottom: "48px",
        }}>
          <p style={{
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "#C44B2E",
            fontWeight: 700,
            marginBottom: "12px",
          }}>
            {typeLabel}
          </p>

          <h1 style={{
            fontSize: "36px",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "#1A1815",
            marginBottom: "16px",
            fontFamily: "var(--font-newsreader), Georgia, serif",
            lineHeight: 1.2,
          }}>
            {report.title}
          </h1>

          <p style={{ fontSize: "13px", color: "#6B6255" }}>
            {RESEARCH_IMPRINT} &middot; Published {formatDate(report.published_at)}
          </p>
        </div>

        {/* What this page is. Until a report has a written summary and real charts, say so
            plainly rather than showing placeholder text and empty chart boxes. */}
        <section style={{ marginBottom: "48px" }}>
          <p style={{ fontSize: "15px", color: "#5A5347", lineHeight: 1.75 }}>
            This {typeLabel.toLowerCase()} is delivered as a PDF. Download it below, or{" "}
            <Link href="/for-institutions#report" style={{ color: "#A93D25", textDecoration: "underline" }}>
              request a competitive fee report for your own institution
            </Link>
            .
          </p>
        </section>

        {/* Email gate — full PDF download */}
        <section style={{
          borderTop: "1px solid #E8DFD1",
          paddingTop: "40px",
        }}>
          <h2 style={{
            fontSize: "20px",
            fontWeight: 600,
            color: "#1A1815",
            marginBottom: "8px",
            fontFamily: "var(--font-newsreader), Georgia, serif",
            letterSpacing: "-0.01em",
          }}>
            Download Full Report
          </h2>
          <p style={{ fontSize: "14px", color: "#5A5347", marginBottom: "24px", lineHeight: 1.6 }}>
            Enter your email to receive a download link for the complete PDF.
          </p>

          <EmailGate slug={slug} artifactExists={artifactExists} />
        </section>

        {/* Methodology link */}
        <div style={{ marginTop: "64px", paddingTop: "24px", borderTop: "1px solid #E8DFD1", fontSize: "12px", color: "#6B6255" }}>
          <p>
            Data collected and verified by the Bank Fee Index.{" "}
            <a href="/methodology" style={{ color: "#5A5347", textDecoration: "underline" }}>
              Read our methodology
            </a>
            .
          </p>
        </div>

      </div>
    </div>
  );
}

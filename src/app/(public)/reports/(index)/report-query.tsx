"use client";

/**
 * The parts of /reports that follow the query string, read in the browser so the page itself
 * reads no search params and is regenerated in the background (ISR) instead of rendered per
 * request (#1811). The prerendered HTML carries the default view; the query's view replaces it
 * on load, the same pattern as the request form (request-report-form.tsx).
 */

import { Suspense, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReportType } from "@/lib/report-engine/types";
import { REPORT_TYPE_LABELS, ReportFilters } from "./report-filters";

type RequestKind = "paid" | "free";

interface RequestSectionProps {
  kind: RequestKind;
  className?: string;
  "aria-labelledby"?: string;
  children: ReactNode;
}

/** `?report=national|district#request` (from the research pages) asks for a free report. */
function freeReportAsked(params: URLSearchParams): boolean {
  const report = params.get("report");
  return report === "national" || report === "district";
}

/**
 * Whichever request section a link's `#request` should land on carries the `request` id: the
 * free form when the link asks for a free report, the paid one otherwise.
 */
function sectionId(kind: RequestKind, freeAsked: boolean): string {
  if (kind === "paid") return freeAsked ? "institution-request" : "request";
  return freeAsked ? "request" : "free-reports";
}

export function RequestSection({ kind, children, ...rest }: RequestSectionProps) {
  return (
    <Suspense
      fallback={
        <section id={sectionId(kind, false)} {...rest}>
          {children}
        </section>
      }
    >
      <RequestSectionWithParams kind={kind} {...rest}>
        {children}
      </RequestSectionWithParams>
    </Suspense>
  );
}

function RequestSectionWithParams({ kind, children, ...rest }: RequestSectionProps) {
  const freeAsked = freeReportAsked(useSearchParams());
  useEffect(() => {
    // The browser jumped to #request before the free form took that id; jump again.
    if (kind === "free" && freeAsked && window.location.hash === "#request") {
      document.getElementById("request")?.scrollIntoView();
    }
  }, [kind, freeAsked]);
  return (
    <section id={sectionId(kind, freeAsked)} {...rest}>
      {children}
    </section>
  );
}

export interface PublishedReportItemView {
  id: string;
  report_type: string;
  slug: string;
  title: string;
  /** ISO timestamp, or null when the stored value does not parse. */
  published_at: string | null;
  /** "3d ago", as of the render. */
  ago: string;
}

const VALID_REPORT_TYPES: Set<string> = new Set<ReportType>([
  "national_index",
  "state_index",
  "peer_brief",
  "monthly_pulse",
]);

const RANGE_DAYS: Record<string, number> = { "30d": 30, "90d": 90, "180d": 180, "365d": 365 };

interface Filters {
  typeFilter: string | null;
  rawRange: string | undefined;
  rangeDays: number | null;
}

/** Sanitize inputs (T-16-03): only a known report type or range filters the list. */
function readFilters(params: URLSearchParams | null): Filters {
  const rawType = params?.get("type") ?? null;
  const rawRange = params?.get("range") ?? undefined;
  return {
    typeFilter: rawType && VALID_REPORT_TYPES.has(rawType) ? rawType : null,
    rawRange: rawRange || undefined,
    rangeDays: rawRange ? (RANGE_DAYS[rawRange] ?? null) : null,
  };
}

export function filterReports(reports: PublishedReportItemView[], filters: Filters, now: number): PublishedReportItemView[] {
  const from = filters.rangeDays === null ? null : now - filters.rangeDays * 86_400_000;
  return reports.filter((report) => {
    if (filters.typeFilter && report.report_type !== filters.typeFilter) return false;
    if (from !== null) {
      const at = report.published_at ? Date.parse(report.published_at) : NaN;
      if (!(at >= from)) return false;
    }
    return true;
  });
}

interface PublishedResearchProps {
  reports: PublishedReportItemView[];
  unavailable: boolean;
}

/** The published research list and its filter bar; `?type=` and `?range=` filter it in the browser. */
export function PublishedResearch(props: PublishedResearchProps) {
  return (
    <Suspense fallback={<PublishedResearchList {...props} params={null} now={0} />}>
      <PublishedResearchWithParams {...props} />
    </Suspense>
  );
}

function PublishedResearchWithParams(props: PublishedResearchProps) {
  const params = useSearchParams();
  // The range filter counts back from when the page loaded.
  const [now] = useState(() => Date.now());
  return <PublishedResearchList {...props} params={params} now={now} />;
}

function PublishedResearchList({
  reports: all,
  unavailable,
  params,
  now,
}: PublishedResearchProps & { params: URLSearchParams | null; now: number }) {
  const filters = readFilters(params);
  const filtersActive = Boolean(filters.typeFilter || filters.rawRange);
  const reports = filtersActive ? filterReports(all, filters, now) : all;
  const hasReports = reports.length > 0;
  // Only show filter controls once there is a catalog to filter (or a filter is already applied).
  const showFilters = all.length > 0 || filtersActive;
  return (
    <>
      {showFilters && (
        <ReportFilters typeFilter={filters.typeFilter} rawRange={filters.rawRange} filtersActive={filtersActive} />
      )}
      {hasReports ? (
        <ul className="m-0 max-w-[800px] list-none p-0">
          {reports.map((report) => (
            <PublishedReportItem key={report.id} report={report} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 max-w-[640px] text-[14px] leading-relaxed text-ink-muted">
          {unavailable
            ? "The research catalog is temporarily unavailable. Try again shortly."
            : filtersActive
              ? "No published reports match these filters."
              : "No national or peer reports are published yet."}
        </p>
      )}
    </>
  );
}

function PublishedReportItem({ report }: { report: PublishedReportItemView }) {
  const typeLabel = REPORT_TYPE_LABELS[report.report_type as ReportType] ?? report.report_type;
  return (
    <li className="flex flex-col gap-2 border-b border-border py-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded bg-paper px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
          {typeLabel}
        </span>
        <span className="text-[12px] text-ink-muted">{report.ago}</span>
      </div>
      <Link href={`/reports/${report.slug}`} className="text-[20px] font-semibold leading-snug tracking-[-0.01em] text-ink no-underline hover:text-brick">
        {report.title}
      </Link>
    </li>
  );
}

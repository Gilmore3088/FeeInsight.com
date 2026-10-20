/**
 * /reports — the paid report's one home (James's simplified mockup, Oct 19). One offer, one
 * demonstration, one form: the promise and two actions beside the report as delivered (drawn
 * from the live sample, so the picture and the sample agree); the sample's position on one fee
 * at a time; what the report includes; the request form; then two quiet links on, to the free
 * research and to Hamilton. Every figure is read from the live sample; when it is slow or down,
 * the picture and the demonstration drop out rather than show stale figures. A link that asks
 * for a free national or district report (`?report=national|district#request`) still reaches
 * the free form, shown only then (free-report-request.tsx).
 *
 * Regenerated in the background (ISR) at most hourly (#1811): the page reads no session and no
 * search params. A render whose sample read failed is cached for a minute instead.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { TrackLink } from "@/components/track-link";
import { HAMILTON_PAGE_NAV } from "@/components/nav-items";
import { CONTACT_EMAIL, REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import { REPORT_SHOWCASE } from "@/lib/report-showcase";
import { loadSampleReport } from "@/lib/custom-report/sample-report";
import { RequestReportForm } from "@/app/for-institutions/request-report-form";
import { homeSerif } from "@/app/landing-serif";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";
import { FreeReportRequest } from "./free-report-request";
import { ReportPreview } from "./report-preview";
import { SamplePosition } from "./sample-position";
import { SERIF, sampleExhibit } from "./report-view";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Competitive Fee Reports",
  description: `See where your fees stand against your local competitors. The ${REPORT_OFFER.name}, from $${REPORT_OFFER.fromPriceUsd}, with a source for every figure.`,
};

const QUERY_DEADLINE_MS = 5_000;

const PAGE = "mx-auto max-w-page px-4 sm:px-6";
const EYEBROW = "text-[12px] font-semibold uppercase tracking-[0.16em] text-[#2f6aa3]";
const H2 = "text-[28px] font-medium leading-[1.15] tracking-[-0.01em] text-ink sm:text-[34px]";
const BAND = "bg-[#f5f7fa]";

const PRIMARY =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-ink px-6 text-[15px] font-semibold text-on-ink transition-opacity hover:opacity-90";
const SECONDARY =
  "inline-flex min-h-12 items-center justify-center rounded-md border border-ink/70 bg-white px-6 text-[15px] font-semibold text-ink transition-colors hover:border-ink hover:bg-[#f5f7fa]";
const TEXT_LINK = "inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-[#2f6aa3] hover:text-ink";

function withDeadline<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeout = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return Promise.race([promise.catch(() => fallback), timeoutPromise]).finally(() => clearTimeout(timeout));
}

function Arrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Check() {
  return (
    <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#dfe9f5] text-[#2f6aa3]">
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** What the report holds, each with the mark of what it is: a chart, an institution, a document. */
const INCLUDED = [
  {
    title: "Competitive fee analysis",
    body: "Named local competitors, published fees, local medians and competitive ranges.",
    icon: <path d="M5 19V11M10 19V7M15 19v-5M20 19V4" strokeLinecap="round" />,
  },
  {
    title: "Financial context",
    body: "Call Report service-charge income and peer context, where the institution reports it.",
    icon: <path d="M3 9l9-5 9 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    title: "Board-ready report",
    body: "A PDF with the findings and a source for every figure: the document, the page, the date.",
    icon: <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" strokeLinecap="round" strokeLinejoin="round" />,
  },
];

const TRUST = ["No payment today", "Scope and delivery date confirmed before purchase", "Comparisons backed by published fee schedules"];

export default async function ReportsPage() {
  const read = await withDeadline(
    loadSampleReport().then((report) => ({ sample: sampleExhibit(report), failed: false })),
    { sample: null, failed: true },
    QUERY_DEADLINE_MS,
  );
  if (read.failed) await shortenPageLife();
  const sample = read.sample;
  const preparedOn = new Date();

  return (
    <div className={`${homeSerif.variable} bg-white pb-4`}>
      {/* 1. The offer, beside the report as delivered. */}
      <section>
        <div className={`${PAGE} grid items-center gap-10 pb-14 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12 lg:pb-20 lg:pt-20`}>
          <div>
            <p className={EYEBROW}>Competitive fee reports</p>
            <h1 className="mt-4 text-[44px] font-medium leading-[1.02] tracking-[-0.02em] text-ink sm:text-[60px] lg:text-[66px]" style={SERIF}>
              Know where your fees stand.
            </h1>
            <p className="mt-5 max-w-[30rem] text-[17px] leading-relaxed text-ink-soft sm:text-[19px]">
              A sourced competitive assessment of your institution&apos;s fees, local competitors and financial context.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <TrackLink event="request_report_click" eventProps={{ placement: "reports_hub_hero" }} href="#request" className={PRIMARY}>
                Request your report <Arrow />
              </TrackLink>
              {sample && (
                <TrackLink event="sample_report_click" eventProps={{ placement: "reports_hero_sample" }} href={REPORT_SHOWCASE.sampleHref} className={SECONDARY}>
                  View a sample report
                </TrackLink>
              )}
            </div>
            <p className="mt-5 flex flex-wrap gap-x-2 gap-y-1 text-[14px] text-ink-muted">
              <span className="whitespace-nowrap">Starting at ${REPORT_OFFER.fromPriceUsd}</span>
              <span className="whitespace-nowrap">
                <span aria-hidden="true">· </span>No payment to request
              </span>
              <span className="whitespace-nowrap">
                <span aria-hidden="true">· </span>Scope confirmed within one business day
              </span>
            </p>
          </div>
          {sample && <ReportPreview sample={sample} preparedOn={preparedOn} />}
        </div>
      </section>

      {/* 2. One demonstration: the live sample, one fee at a time. */}
      {sample && (
        <section aria-labelledby="sample-heading" className={`${BAND} border-y border-[#e6e9ef]`}>
          <div className={`${PAGE} py-14 sm:py-16`}>
            <p className={EYEBROW}>Sample analysis</p>
            <div className="mt-3">
              <SamplePosition sample={sample} />
            </div>
          </div>
        </section>
      )}

      {/* 3. What the report includes. */}
      <section aria-labelledby="included-heading" className={`${PAGE} py-14 sm:py-16`}>
        <h2 id="included-heading" className={H2} style={SERIF}>
          What&apos;s included in the report
        </h2>
        <ul className="mt-8 grid gap-8 md:grid-cols-3 md:gap-0 md:divide-x md:divide-[#e6e9ef]">
          {INCLUDED.map((item, i) => (
            <li key={item.title} className={`flex gap-4 ${i === 0 ? "md:pr-8" : "md:px-8"}`}>
              <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#e8eff8] text-[#2f6aa3]">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
                  {item.icon}
                </svg>
              </span>
              <div>
                <h3 className="text-[18px] font-medium text-ink" style={SERIF}>
                  {item.title}
                </h3>
                <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 4. The one form. */}
      <section id="request" aria-labelledby="request-heading" className={`${PAGE} scroll-mt-24`}>
        <div className={`${BAND} grid gap-8 rounded-xl border border-[#e6e9ef] px-5 py-10 sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12 lg:py-12`}>
          <div>
            <p className={EYEBROW}>Request your report</p>
            <h2 id="request-heading" className={`${H2} mt-3`} style={SERIF}>
              Get a custom competitive fee report.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
              Starting at ${REPORT_OFFER.fromPriceUsd}. We&apos;ll confirm your scope and price within one business day.
            </p>
            <ul className="mt-6 space-y-3">
              {TRUST.map((item) => (
                <li key={item} className="flex items-center gap-3 text-[15px] text-ink">
                  <Check />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <RequestReportForm contactEmail={CONTACT_EMAIL} defaultSrc="reports-hub" defaultReportType="institution" offer="institution" compact />
        </div>
      </section>

      {/* The free form, only for a link that asked for a free report. */}
      <FreeReportRequest contactEmail={CONTACT_EMAIL} />

      {/* 5. Two quiet ways on: the free research, and Hamilton. */}
      <section className={`${PAGE} pt-14 sm:pt-16`}>
        <div className="grid gap-10 border-t border-[#e6e9ef] pt-10 md:grid-cols-2 md:gap-0 md:divide-x md:divide-[#e6e9ef]">
          <div className="md:pr-10">
            <h2 className="text-[22px] font-medium text-ink" style={SERIF}>
              Explore our public research
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
              Free national and Federal Reserve district fee reports from the Bank Fee Index.
            </p>
            <Link href="/research" className={`${TEXT_LINK} mt-2`}>
              View public reports <Arrow />
            </Link>
          </div>
          <div className="md:pl-10">
            <h2 className="text-[22px] font-medium text-ink" style={SERIF}>
              Go beyond a one-time report
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
              Hamilton, the {SITE_NAME} workspace, puts competitive fees, financial performance and market research in one place.
            </p>
            <TrackLink event="upgrade_click" eventProps={{ placement: "reports_hub_closing" }} href={HAMILTON_PAGE_NAV.href} className={`${TEXT_LINK} mt-2`}>
              Explore Hamilton <Arrow />
            </TrackLink>
          </div>
        </div>
      </section>
    </div>
  );
}

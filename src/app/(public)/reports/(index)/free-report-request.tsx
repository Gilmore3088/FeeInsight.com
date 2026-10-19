"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { RequestReportForm } from "@/app/for-institutions/request-report-form";

/**
 * The free national and Fed district form, shown only to a link that asks for a free report
 * (`?report=national|district#request`, from the research pages), so on every other visit the
 * paid request is the page's one form. The query is read in the browser, so the page itself
 * reads no search params and is regenerated in the background (ISR, #1811). The browser jumps
 * to the paid #request first; this then scrolls to the form the link asked for.
 */
export function FreeReportRequest({ contactEmail }: { contactEmail: string }) {
  return (
    <Suspense fallback={null}>
      <FreeReportRequestWithParams contactEmail={contactEmail} />
    </Suspense>
  );
}

function FreeReportRequestWithParams({ contactEmail }: { contactEmail: string }) {
  const report = useSearchParams().get("report");
  const asked = report === "national" || report === "district";
  useEffect(() => {
    if (asked && window.location.hash === "#request") document.getElementById("free-request")?.scrollIntoView();
  }, [asked]);
  if (!asked) return null;
  return (
    <section id="free-request" aria-labelledby="free-heading" className="mx-auto max-w-page scroll-mt-24 px-4 pt-14 sm:px-6">
      <div className="mx-auto max-w-[36rem]">
        <h2 id="free-heading" className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
          Free national and Fed district reports
        </h2>
        <p className="mt-1 text-[14px] text-ink-muted">The headline fees for the U.S. or for one Fed district.</p>
        <div className="mt-5">
          <RequestReportForm contactEmail={contactEmail} defaultSrc="reports-hub-free" defaultReportType="national" offer="free" idScope="-free" />
        </div>
      </div>
    </section>
  );
}

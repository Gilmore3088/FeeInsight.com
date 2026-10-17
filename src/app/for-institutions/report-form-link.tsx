"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { reportFormHref } from "./report-form-href";

interface ReportFormLinkProps {
  className: string;
  children: React.ReactNode;
}

/**
 * The /reports form link, carrying the visitor's query through. The query is read in the
 * browser so /for-institutions itself can be cached (#1168); until it is read, the link
 * opens the form on the institution report.
 */
export function ReportFormLink(props: ReportFormLinkProps) {
  return (
    <Suspense fallback={<Link href={reportFormHref()} className={props.className}>{props.children}</Link>}>
      <ReportFormLinkWithParams {...props} />
    </Suspense>
  );
}

function ReportFormLinkWithParams({ className, children }: ReportFormLinkProps) {
  const params = useSearchParams();
  return (
    <Link href={reportFormHref(Object.fromEntries(params.entries()))} className={className}>
      {children}
    </Link>
  );
}

import { notFound } from "next/navigation";
import { loadPublicReport } from "./load-report";

/**
 * A slug with no public report answers 404 (#1267). The check sits in this layout, with no
 * loading skeleton above it: once a skeleton streams, the status is fixed at 200. The read is
 * shared with the metadata and the page, and a database error fails the render rather than
 * reading as "missing".
 */
export default async function ReportLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(await loadPublicReport(slug))) notFound();
  return children;
}

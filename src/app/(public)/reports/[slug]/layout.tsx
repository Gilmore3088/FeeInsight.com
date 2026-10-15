import { notFound } from "next/navigation";
import { getSql } from "@/lib/data-store/connection";

/**
 * A slug with no public report answers 404 (#1267). The check sits in this layout, with no
 * loading skeleton above it: once a skeleton streams, the status is fixed at 200.
 *
 * Unlike the page's own read, a database error is not taken as "missing": it fails the
 * render, so a blip is never cached as a 404 for the hour this route keeps its pages.
 */
async function reportExists(slug: string): Promise<boolean> {
  const sql = getSql();
  const rows = await sql<{ found: number }[]>`
    SELECT 1 AS found
      FROM published_reports pr
      JOIN report_jobs rj ON pr.job_id = rj.id
     WHERE pr.slug = ${slug}
       AND pr.is_public = true
     LIMIT 1
  `;
  return rows.length > 0;
}

export default async function ReportLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(await reportExists(slug))) notFound();
  return children;
}

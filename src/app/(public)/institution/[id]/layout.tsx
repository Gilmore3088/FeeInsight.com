import { notFound } from "next/navigation";
import { getPublicInstitutionForPage } from "./profile-data";

/**
 * A missing institution answers 404 (#1165). The check sits in this layout, outside the
 * page's loading boundary: once a loading skeleton streams, the status is fixed at 200, so a
 * notFound() in the page or its metadata comes too late. The lookup is cached per request, so
 * the page and its metadata reuse it.
 */
export default async function InstitutionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const instId = parseInt(id, 10);
  if (Number.isNaN(instId)) notFound();
  if (!(await getPublicInstitutionForPage(instId))) notFound();
  return children;
}

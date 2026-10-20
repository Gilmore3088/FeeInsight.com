import { notFound } from "next/navigation";
import { createPublicReadBudget as createReadBudget } from "@/lib/public-read-budget";
import { getPublicInstitutionForPage } from "./profile-data";
import { LAYOUT_READ_BUDGET_MS } from "./profile-budget";

/**
 * A missing institution answers 404 (#1165). The check sits in this layout, outside the
 * page's loading boundary: once a loading skeleton streams, the status is fixed at 200, so a
 * notFound() in the page or its metadata comes too late. The lookup is cached per request, so
 * the page and its metadata reuse it.
 *
 * Nothing streams until this check answers, so it has its own deadline (#1919): with the
 * connection pool saturated it waited until the function was killed at 300 seconds. Past the
 * deadline the public error boundary answers instead.
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
  const budget = createReadBudget(LAYOUT_READ_BUDGET_MS, "Institution layout");
  if (!(await budget.required(() => getPublicInstitutionForPage(instId), "institution"))) notFound();
  return children;
}

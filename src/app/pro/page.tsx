import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * /pro has no page of its own. Pro members go to the Hamilton workspace; everyone else is
 * sent to pricing. (The layout and proxy already gate this path; this keeps the route
 * honest if either changes.) Marketing for institutions lives on /for-institutions.
 */
export default async function ProIndexPage() {
  const user = await getCurrentUser().catch(() => null);
  redirect(user && canAccessPremium(user) ? "/pro/hamilton" : "/subscribe?from=%2Fpro");
}

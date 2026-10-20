/**
 * The district report for a signed-in reader, rendered per request with their account (Pro
 * sees every category and the full Beige Book). Reached only through the proxy's rewrite of
 * /research/district/<id>; a direct request answers 404 (viewer-variant.ts).
 */
export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { DistrictReport } from "../district-report";

export { generateMetadata } from "../district-report";

export default async function SignedInDistrictReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DistrictReport id={id} user={await getCurrentUser()} />;
}

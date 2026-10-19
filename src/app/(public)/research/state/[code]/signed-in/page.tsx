/**
 * The state report for a signed-in reader, rendered per request with their account (Pro sees
 * every category and the full Beige Book). Reached only through the proxy's rewrite of
 * /research/state/<code>; a direct request answers 404 (viewer-variant.ts).
 */
export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { StateReport } from "../state-report";

export { generateMetadata } from "../state-report";

export default async function SignedInStateReportPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <StateReport code={code} user={await getCurrentUser()} />;
}

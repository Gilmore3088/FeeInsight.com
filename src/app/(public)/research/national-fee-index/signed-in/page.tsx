/**
 * The national index for a signed-in reader, rendered per request with their account (Pro sees
 * every category with bank and credit union counts). Reached only through the proxy's rewrite
 * of /research/national-fee-index; a direct request answers 404 (viewer-variant.ts).
 */
export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { NationalReport } from "../national-report";

export { metadata } from "../national-report";

export default async function SignedInNationalFeeIndexPage() {
  return <NationalReport user={await getCurrentUser()} />;
}

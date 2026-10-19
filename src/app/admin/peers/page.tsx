import { permanentRedirect } from "next/navigation";
import { buildAdminRedirectPath, type AdminSearchParams } from "@/lib/admin-redirect-path";

/**
 * The Peer Analysis screen was the catalog's "Compare a segment" again: a charter, asset tier or
 * Fed district's median per fee type against the national one, from the same query. Its one
 * extra filter, the Fed district, now sits in the catalog's segment, and its charter, tier and
 * district params carry over unchanged (#1122). Peer groups (/admin/peers/explore) and peer
 * institutions (/admin/peers/[id]) stay.
 */
export default async function PeersRedirect({
  searchParams,
}: {
  searchParams: Promise<AdminSearchParams>;
}) {
  permanentRedirect(buildAdminRedirectPath("/admin/fees/catalog", await searchParams));
}

import { permanentRedirect } from "next/navigation";
import { buildAdminRedirectPath, type AdminSearchParams } from "@/lib/admin-redirect-path";

/**
 * The Marketing team screen only re-exported the Growth page, so it showed the same board under
 * a second address. Old links (the marketing cards' `?view=team&agent=`) land on Growth with their
 * query kept (#1122).
 */
export default async function MarketingTeamRedirect({
  searchParams,
}: {
  searchParams: Promise<AdminSearchParams>;
}) {
  permanentRedirect(buildAdminRedirectPath("/admin/growth", await searchParams));
}

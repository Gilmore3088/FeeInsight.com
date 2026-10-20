import { permanentRedirect } from "next/navigation";
import { buildAdminRedirectPath, type AdminSearchParams } from "@/lib/admin-redirect-path";

/**
 * The National Index screen showed the fee catalog's table again: per fee type, the median,
 * P25/P75, institution and bank/CU counts from the same approved published_fee_catalog rows and
 * the same statistics (summarizeFeesBy). Its one extra column, maturity, now sits in the catalog
 * (#1122).
 */
export default async function NationalIndexRedirect({
  searchParams,
}: {
  searchParams: Promise<AdminSearchParams>;
}) {
  permanentRedirect(buildAdminRedirectPath("/admin/fees/catalog", await searchParams));
}

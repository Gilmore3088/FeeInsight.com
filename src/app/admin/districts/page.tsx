export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { getDistrictOverview } from "@/lib/admin-queries";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DistrictsTable } from "./districts-table";

export default async function DistrictsPage() {
  await requireAuth("operate");

  let districts: Awaited<ReturnType<typeof getDistrictOverview>> = [];

  try {
    districts = await getDistrictOverview();
  } catch (e) {
    console.error("Districts page load failed:", e);
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[{ label: "Dashboard", href: "/admin" }, { label: "Districts" }]}
        />
        <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          Federal Reserve Districts
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Coverage, mapped states, and fee publication status by Fed district
        </p>
        <div className="mt-3">
          <Link
            href="/admin/states"
            className="inline-flex rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-blue-200 hover:text-blue-700 dark:border-white/[0.08] dark:text-gray-300 dark:hover:border-blue-900/60 dark:hover:text-blue-300"
          >
            View states
          </Link>
        </div>
      </div>

      {districts.length > 0 ? (
        <DistrictsTable districts={districts} />
      ) : (
        <div className="text-center py-12 text-sm text-gray-400">
          No district data available
        </div>
      )}
    </div>
  );
}

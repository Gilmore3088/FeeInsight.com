export const dynamic = "force-dynamic";
import { requireAuth } from "@/lib/auth";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { QueryClient } from "./query-client";

export default async function QueryPage() {
  await requireAuth("operate");

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Admin", href: "/admin" },
            { label: "SQL Explorer" },
          ]}
        />
        <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          SQL Explorer
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Run read-only SQL queries against the database
        </p>
      </div>

      <QueryClient />
    </div>
  );
}

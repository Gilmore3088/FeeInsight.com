export const dynamic = "force-dynamic";
import { requireAuth } from "@/lib/auth";
import { describeLeadEmailConfig } from "@/lib/email/lead-notification";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { getLeads } from "@/lib/admin-queries";
import type { LeadRow } from "@/lib/admin-queries";
import { EmailDeliveryPanel } from "./email-delivery-panel";
import { LeadsTable } from "./leads-table";

export default async function LeadsPage() {
  const user = await requireAuth("view");

  let leads: LeadRow[] = [];
  try {
    leads = await getLeads();
  } catch {
    leads = [];
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Admin", href: "/admin" },
            { label: "Leads" },
          ]}
        />
        <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          Leads
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {leads.length} lead{leads.length !== 1 ? "s" : ""} collected
        </p>
      </div>

      <EmailDeliveryPanel config={describeLeadEmailConfig()} defaultTo={user.email ?? ""} />

      <LeadsTable leads={leads} />
    </div>
  );
}

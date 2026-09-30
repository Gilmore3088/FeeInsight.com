"use client";

import { useState } from "react";
import type { LeadRow } from "@/lib/admin-queries";

const ROLE_LABELS: Record<string, string> = {
  bank_cu: "Bank / CU",
  consultant: "Consultant",
  fintech: "Fintech",
  compliance: "Compliance",
  researcher: "Researcher",
  other: "Other",
};

const SOURCE_LABELS: Record<string, string> = {
  contact_enterprise: "Enterprise licensing",
  contact_report: "Custom report",
  contact_partnership: "Data partnership",
  contact_general: "General inquiry",
  coming_soon: "Coming soon signup",
  newsletter: "Footer newsletter",
  capture_institution: "Institution fee alerts",
  capture_state: "State benchmark",
  capture_national_index: "National index update",
  capture_report_sample: "Sample report (lead magnet)",
};

/** Sources accumulate as a comma-separated list; label each one. */
function sourceLabel(source: string | null | undefined) {
  if (!source) return "\u2014";
  return source
    .split(",")
    .map((part) => SOURCE_LABELS[part.trim()] || part.trim())
    .join(", ");
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    new: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    contacted: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
    converted: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
    updated: "bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles[status] || "bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400"}`}
    >
      {status}
    </span>
  );
}

export function LeadsTable({ leads }: { leads: LeadRow[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  function toggle(id: number) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  if (leads.length === 0) {
    return (
      <div className="admin-card px-4 py-8 text-center text-gray-400">
        No leads yet
      </div>
    );
  }

  return (
    <div className="admin-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50/80 dark:bg-white/[0.02] border-b border-gray-200 dark:border-white/[0.06]">
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Name
              </th>
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Email
              </th>
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Company
              </th>
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Source
              </th>
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Date
              </th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const isExpanded = expandedId === lead.id;
              return (
                <tr
                  key={lead.id}
                  className="border-b border-gray-100 dark:border-white/[0.04] group"
                >
                  <td colSpan={6} className="p-0">
                    <button
                      type="button"
                      onClick={() => toggle(lead.id)}
                      className="w-full text-left grid grid-cols-[1fr_1fr_1fr_auto_auto_auto] items-center hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <span className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-200">
                        {lead.name}
                      </span>
                      <span className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                        {lead.email}
                      </span>
                      <span className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                        {lead.company || "\u2014"}
                      </span>
                      <span className="px-4 py-2.5 text-gray-500 text-xs">
                        {sourceLabel(lead.source)}
                      </span>
                      <span className="px-4 py-2.5">
                        <StatusBadge status={lead.status} />
                      </span>
                      <span className="px-4 py-2.5 text-gray-400 text-xs tabular-nums">
                        {lead.created_at}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-white/[0.04] bg-gray-50/40 dark:bg-white/[0.01]">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
                          <div>
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">
                              Role
                            </p>
                            <p className="text-sm text-gray-700 dark:text-gray-300">
                              {ROLE_LABELS[lead.role || ""] || lead.role || "\u2014"}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">
                              Source
                            </p>
                            <p className="text-sm text-gray-700 dark:text-gray-300">
                              {sourceLabel(lead.source)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">
                              Email
                            </p>
                            <a
                              href={`mailto:${lead.email}`}
                              className="text-sm text-blue-600 hover:text-blue-700 transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {lead.email}
                            </a>
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                            Message
                          </p>
                          <div className="rounded-lg border border-gray-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] px-4 py-3">
                            <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                              {lead.use_case || "No message provided."}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

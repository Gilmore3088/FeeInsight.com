"use client";

import { useActionState, useState } from "react";
import type { LeadRow } from "@/lib/admin-queries";
import {
  LEAD_RESPONSE_HOURS,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  isLeadOverdue,
  isLeadStatus,
  leadDueAt,
} from "@/lib/leads/lead-status";
import { setLeadStatusAction, type LeadStatusState } from "./status-actions";

const INITIAL_STATUS_STATE: LeadStatusState = { status: "idle", message: "" };

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
  capture_homepage: "Homepage sample report",
};

/** Sources accumulate as a comma-separated list; label each one. */
function sourceLabel(source: string | null | undefined) {
  if (!source) return "\u2014";
  return source
    .split(",")
    .map((part) => SOURCE_LABELS[part.trim()] || part.trim())
    .join(", ");
}

const STATUS_STYLES: Record<string, string> = {
  new: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  in_progress: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
  overdue: "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  email_failed: "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  needs_reply: "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  held: "bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  sent: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
  followed_up: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
};

function StatusBadge({ status, overdue }: { status: string; overdue: boolean }) {
  const shown = overdue && status !== "overdue" ? "overdue" : status;
  const label = isLeadStatus(shown) ? LEAD_STATUS_LABELS[shown] : shown;
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_STYLES[shown] || "bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400"}`}
    >
      {label}
    </span>
  );
}

function formatDue(due: Date): string {
  return `${due.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function LeadStatusForm({ lead }: { lead: LeadRow }) {
  const [state, formAction, isPending] = useActionState(setLeadStatusAction, INITIAL_STATUS_STATE);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={lead.id} />
      <label htmlFor={`lead-status-${lead.id}`} className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
        Status
      </label>
      <select
        id={`lead-status-${lead.id}`}
        name="status"
        defaultValue={isLeadStatus(lead.status) ? lead.status : "new"}
        className="rounded border border-gray-200 bg-white px-2 py-1 text-sm text-gray-800 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200"
      >
        {LEAD_STATUSES.map((status) => (
          <option key={status} value={status}>
            {LEAD_STATUS_LABELS[status]}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-gray-900 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-gray-900"
      >
        {isPending ? "Saving" : "Save"}
      </button>
      {state.message && (
        <span className={`text-xs ${state.status === "error" ? "text-red-600" : "text-emerald-600"}`}>{state.message}</span>
      )}
    </form>
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
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Due
              </th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const isExpanded = expandedId === lead.id;
              const leadForDue = { source: lead.source, status: lead.status, created_at: lead.created_at_iso };
              const due = leadDueAt(leadForDue);
              const overdue = isLeadOverdue(leadForDue);
              return (
                <tr
                  key={lead.id}
                  className="border-b border-gray-100 dark:border-white/[0.04] group"
                >
                  <td colSpan={7} className="p-0">
                    <button
                      type="button"
                      onClick={() => toggle(lead.id)}
                      className="w-full text-left grid grid-cols-[1fr_1fr_1fr_auto_auto_auto_auto] items-center hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors"
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
                        <StatusBadge status={lead.status} overdue={overdue} />
                      </span>
                      <span className="px-4 py-2.5 text-gray-400 text-xs tabular-nums">
                        {lead.created_at}
                      </span>
                      <span className={`px-4 py-2.5 text-xs tabular-nums ${overdue ? "font-semibold text-red-600" : "text-gray-400"}`}>
                        {due ? formatDue(due) : "\u2014"}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-white/[0.04] bg-gray-50/40 dark:bg-white/[0.01]">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <LeadStatusForm lead={lead} />
                          {due && (
                            <p className={`text-xs ${overdue ? "font-semibold text-red-600" : "text-gray-500"}`}>
                              {overdue ? "Overdue: " : "Answer by "}
                              {formatDue(due)} ({LEAD_RESPONSE_HOURS}h from the request)
                            </p>
                          )}
                        </div>
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

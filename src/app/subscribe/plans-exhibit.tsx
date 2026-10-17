import { Calculator, Database, FileText, Landmark, MessageCircle, Newspaper, Users } from "lucide-react";
import { PRODUCT_NAME } from "@/lib/constants";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";

/**
 * What every plan includes: full access to the index first (James, Oct 16: the relationship is
 * what someone is buying), then the workspace's own screen names (HAMILTON_WORKSPACE_NAV), one line each.
 */
export const PLAN_INCLUDES = [
  { icon: Database, label: `Full ${PRODUCT_NAME} access`, line: "Every fee, benchmark and source" },
  { icon: Landmark, label: "Your institution", line: "Each fee against your market" },
  { icon: MessageCircle, label: "Ask Hamilton", line: "Answers with a chart and a source" },
  { icon: Calculator, label: "Try a price", line: "Model a fee before committee" },
  { icon: FileText, label: "Reports", line: "Briefs for the board and committee" },
  { icon: Newspaper, label: "Regulatory Wire", line: "Fee rules and bills, beside the data" },
  { icon: Users, label: `Up to ${WORKSPACE_SEAT_LIMIT} people`, line: "Each with their own login" },
] as const;

export function PlanIncludes() {
  return (
    <section aria-labelledby="plan-includes-heading" className="mt-10">
      <h2 id="plan-includes-heading" className="text-center text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        Every plan includes
      </h2>
      <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-7">
        {PLAN_INCLUDES.map(({ icon: Icon, label, line }, i) => (
          // The index access leads on its own row on phones and tablets, so it reads as the base.
          <li key={label} className={`flex min-w-0 flex-col items-center text-center ${i === 0 ? "col-span-2 sm:col-span-3 lg:col-span-1" : ""}`}>
            <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-200 text-ink">
              <Icon size={18} strokeWidth={1.75} />
            </span>
            <p className="mt-2 text-sm font-semibold text-ink">{label}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">{line}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

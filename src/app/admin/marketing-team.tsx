import Link from "next/link";
import type { MarketingMember } from "@/lib/data-store/marketing-team";

const TONE: Record<MarketingMember["tone"], { dot: string; text: string }> = {
  working: { dot: "bg-emerald-500", text: "text-emerald-800 dark:text-emerald-300" },
  paused: { dot: "bg-gray-400", text: "text-gray-600 dark:text-gray-400" },
  idle: { dot: "bg-gray-300", text: "text-gray-500" },
};

/** The marketing agents, one card each, next to the pipeline crew. Each opens its part of the Growth page. */
export function MarketingTeam({ team }: { team: MarketingMember[] }) {
  return (
    <section aria-label="The marketing team">
      <p className="admin-section-title">The marketing team</p>
      <ul className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {team.map((member) => {
          const tone = TONE[member.tone];
          return (
            <li key={member.agent}>
              <Link
                href={`/admin/agents/marketing?view=team&agent=${member.agent}`}
                prefetch={false}
                className="block h-full rounded-lg border border-black/[0.08] px-4 py-3 transition-colors hover:border-black/20 dark:border-white/[0.1] dark:hover:border-white/25"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{member.name}</p>
                  <span aria-hidden="true" className="text-sm font-semibold text-[var(--brand-primary)]">›</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">{member.role}</p>
                <p className={`mt-2 inline-flex items-center gap-1.5 text-xs font-semibold ${tone.text}`}>
                  <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                  {member.status}
                </p>
                {member.waiting > 0 ? (
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">{member.waiting} waiting for your approval</p>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

import Link from "next/link";
import { ArrowRight } from "lucide-react";

type HandoffStep = {
  label: string;
  title: string;
  detail: string;
  href: string;
  current?: boolean;
};

export function AgentHandoffStrip({
  title = "Pipeline handoff",
  steps,
}: {
  title?: string;
  steps: HandoffStep[];
}) {
  return (
    <section aria-labelledby="agent-handoff-heading" className="border-y border-black/[0.06] py-4 dark:border-white/[0.06]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p id="agent-handoff-heading" className="admin-label">{title}</p>
        <Link href="/admin/live" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-primary)] hover:text-[var(--brand-primary-hover)]">
          Live status<ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="grid gap-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <Link
            key={`${step.label}:${step.href}`}
            href={step.href}
            aria-current={step.current ? "step" : undefined}
            className={`group min-h-28 rounded-md border px-3 py-3 transition-colors ${
              step.current
                ? "border-[var(--brand-primary)] bg-[var(--brand-primary-soft)]"
                : "border-black/[0.06] hover:bg-black/[0.015] dark:border-white/[0.06] dark:hover:bg-white/[0.02]"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {index + 1}. {step.label}
              </p>
              <ArrowRight className="h-3.5 w-3.5 text-gray-300 transition-colors group-hover:text-[var(--brand-primary)]" />
            </div>
            <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{step.title}</p>
            <p className="admin-meta mt-1">{step.detail}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

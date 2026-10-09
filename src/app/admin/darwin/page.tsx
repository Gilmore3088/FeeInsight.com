import { Suspense } from "react";
import { DarwinConsole } from "./components/darwin-console";
import { LoopPanels } from "./components/loop-panels";
import { fetchDarwinStatus } from "./actions";
import type { DarwinStatus } from "./types";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AgentHandoffStrip } from "@/components/agent-console/agent-handoff-strip";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DarwinPage() {
  await requireAuth("view");
  const status = await fetchDarwinStatus().catch((): DarwinStatus => ({
    pending: null,
    today_promoted: null,
    today_cost_usd: null,
    circuit: { halted: false },
    last_step: null,
    as_of: null,
  }));

  return (
    <div className="space-y-7">
      <header>
        <Breadcrumbs items={[{ label: "Atlas", href: "/admin" }, { label: "Darwin" }]} />
        <p className="admin-eyebrow mt-3">Agent · Classify</p>
        <h1 className="admin-display-title mt-1">Darwin</h1>
        <p className="admin-lede mt-2">
          Turns raw extracted fee rows into verified categories, amounts, and review-ready exceptions.
        </p>
      </header>
      <AgentHandoffStrip
        steps={[
          {
            label: "Input",
            title: "Knox raw observations",
            detail: "Knox creates source-grounded rows that need verification.",
            href: "/admin/knox",
          },
          {
            label: "Current",
            title: "Darwin verifies",
            detail: "Check canonical hints, lineage, duplicates, and amount reasonableness.",
            href: "/admin/darwin",
            current: true,
          },
          {
            label: "Next",
            title: "Hamilton publishes",
            detail: "Publish eligible verified rows into product read models.",
            href: "/admin/data",
          },
          {
            label: "Exceptions",
            title: "Knox reviews",
            detail: "Resolve anomaly-only decisions without blocking clean verified rows.",
            href: "/admin/knox",
          },
        ]}
      />
      <div className="border-y border-black/[0.06] py-5 dark:border-white/[0.06]">
        <div className="grid gap-4 sm:grid-cols-3">
          <Step number="1" title="Read raw fees" detail="Pull source-grounded rows from the Knox extraction queue." />
          <Step number="2" title="Verify safely" detail="Apply canonical, amount, duplicate, and lineage checks." />
          <Step number="3" title="Publish or route" detail="Promote clean rows and keep suspicious rows reviewable." />
        </div>
      </div>
      <DarwinConsole initialStatus={status} />
      <div>
        <h2 className="mb-2 text-sm font-bold text-gray-800 dark:text-gray-200">Classifier loop</h2>
        <Suspense fallback={<div className="skeleton h-40 w-full" />}>
          <LoopPanels />
        </Suspense>
      </div>
    </div>
  );
}

function Step({ number, title, detail }: { number: string; title: string; detail: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-primary-soft)] text-[11px] font-bold text-[var(--brand-primary)]">{number}</span>
      <div>
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p>
        <p className="admin-meta mt-1">{detail}</p>
      </div>
    </div>
  );
}

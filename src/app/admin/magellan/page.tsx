import { Breadcrumbs } from "@/components/breadcrumbs";
import { AgentHandoffStrip } from "@/components/agent-console/agent-handoff-strip";
import { requireAuth } from "@/lib/auth";
import { MagellanConsole } from "../coverage/components/magellan-console";
import { fetchMagellanStatus } from "../coverage/actions";

export const dynamic = "force-dynamic";

export default async function MagellanPage() {
  await requireAuth("view");
  const status = await fetchMagellanStatus().catch(() => ({
    pending: 0,
    rescued: 0,
    dead: 0,
    needs_human: 0,
    retry_after: 0,
    today_cost_usd: 0,
    circuit: { halted: false },
  }));

  return (
    <div className="space-y-7">
      <header>
        <Breadcrumbs items={[{ label: "Atlas", href: "/admin" }, { label: "Magellan" }]} />
        <p className="admin-eyebrow mt-3">Agent · Discover</p>
        <h1 className="admin-display-title mt-1">Magellan</h1>
        <p className="admin-lede mt-2">
          Finds fee schedules, coordinates URL rescue, and hands collection work to the extraction fleet.
        </p>
        <p className="mt-2 text-sm">
          <a href="/admin/magellan/registry" className="font-medium underline">
            Regulatory registry
          </a>{" "}
          — FDIC, NCUA, CFPB, SEC, and Federal Reserve data loads.
        </p>
      </header>
      <AgentHandoffStrip
        steps={[
          {
            label: "Input",
            title: "Source trust + state lanes",
            detail: "Use accepted sources, state memory, and institution attributes before discovery.",
            href: "/admin/quality",
          },
          {
            label: "Current",
            title: "Magellan discovers + fetches",
            detail: "Find fee URLs and collect fresh source documents.",
            href: "/admin/magellan",
            current: true,
          },
          {
            label: "Next",
            title: "Rosetta reads",
            detail: "Normalize fetched PDFs and HTML into text artifacts.",
            href: "/admin/rosetta",
          },
          {
            label: "Extract",
            title: "Knox extracts",
            detail: "Create conservative raw fee observations from Rosetta text.",
            href: "/admin/knox",
          },
        ]}
      />
      <div className="border-y border-black/[0.06] py-5 dark:border-white/[0.06]">
        <div className="grid gap-4 sm:grid-cols-3">
          <Step number="1" title="Find fee URL" detail="Resolve eligible institutions without a usable fee schedule URL." />
          <Step number="2" title="Fetch source document" detail="Collect PDFs, HTML, or text through the agentic run ledger." />
          <Step number="3" title="Hand off to Rosetta" detail="Send fetched documents into source-text normalization." />
        </div>
      </div>
      <MagellanConsole initialStatus={status} />
    </div>
  );
}

function Step({ number, title, detail }: { number: string; title: string; detail: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-primary-soft)] text-[11px] font-bold text-[var(--brand-primary)]">{number}</span>
      <div><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p><p className="admin-meta mt-1">{detail}</p></div>
    </div>
  );
}

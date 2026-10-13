import { Breadcrumbs } from "@/components/breadcrumbs";
import { AgentHandoffStrip } from "@/components/agent-console/agent-handoff-strip";
import { requireAuth } from "@/lib/auth";
import { getRosettaStatus } from "@/lib/agents/rosetta/status";
import { RosettaConsole } from "./rosetta-console";
import { AgentFrame } from "../agent-frame";

export const dynamic = "force-dynamic";

function number(value: number): string {
  return value.toLocaleString("en-US");
}

export default async function RosettaPage() {
  await requireAuth("view");
  const status = await getRosettaStatus();

  return (
    <div className="space-y-7">
      <header>
        <Breadcrumbs items={[{ label: "Atlas", href: "/admin" }, { label: "Rosetta" }]} />
        <p className="admin-eyebrow mt-3">Agent · Read</p>
        <h1 className="admin-display-title mt-1">Rosetta</h1>
        <p className="admin-lede mt-2">
          Reads fetched PDFs, HTML, and text sources into normalized artifacts that Knox can extract from.
        </p>
      </header>
      <AgentFrame agent="rosetta" />

      <AgentHandoffStrip
        steps={[
          {
            label: "Input",
            title: "Magellan fetched sources",
            detail: "Successful source documents arrive from Magellan collection.",
            href: "/admin/magellan",
          },
          {
            label: "Current",
            title: "Rosetta reads",
            detail: "Normalize PDFs, HTML, and text while preserving OCR/browser-render backlog.",
            href: "/admin/rosetta",
            current: true,
          },
          {
            label: "Next",
            title: "Knox extracts",
            detail: "Convert Rosetta text artifacts into conservative raw fee observations.",
            href: "/admin/knox",
          },
          {
            label: "Verify",
            title: "Darwin verifies",
            detail: "Promote raw fee rows into verified fee observations.",
            href: "/admin/darwin",
          },
        ]}
      />

      <section aria-label="Rosetta status" className="grid gap-x-6 gap-y-4 border-y border-black/[0.06] py-5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 dark:border-white/[0.06]">
        <StatusMetric label="Readable backlog" value={number(status.readableBacklog)} tone={status.readableBacklog > 0 ? "work" : "default"} />
        <StatusMetric label="Completed texts" value={number(status.completedTexts)} />
        <StatusMetric label="Completed today" value={number(status.completedToday)} />
        <StatusMetric label="OCR backlog" value={number(status.needsOcr)} tone={status.needsOcr > 0 ? "warning" : "default"} />
        <StatusMetric label="Browser render" value={number(status.browserRenderBacklog)} tone={status.browserRenderBacklog > 0 ? "warning" : "default"} />
        <StatusMetric label="Failed reads" value={number(status.failedReads)} tone={status.failedReads > 0 ? "danger" : "default"} />
        <StatusMetric label="Text artifacts" value={number(status.totalTextArtifacts)} />
      </section>

      <div className="border-y border-black/[0.06] py-5 dark:border-white/[0.06]">
        <div className="grid gap-4 sm:grid-cols-3">
          <Step number="1" title="Select readable source documents" detail="Use fetched documents that do not already have a current text artifact." />
          <Step number="2" title="Normalize text" detail="Extract embedded PDF text or strip HTML into stable text." />
          <Step number="3" title="Route backlog" detail="Mark scanned PDFs for OCR and empty HTML for browser-render follow-up." />
        </div>
      </div>

      <RosettaConsole />
    </div>
  );
}

function StatusMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "work" | "warning" | "danger";
}) {
  const valueClass = tone === "danger"
    ? "text-red-700 dark:text-red-400"
    : tone === "warning"
      ? "text-amber-700 dark:text-amber-400"
      : tone === "work"
        ? "text-blue-700 dark:text-blue-400"
        : "text-gray-900 dark:text-gray-100";

  return (
    <div>
      <p className="admin-label">{label}</p>
      <p className={`mt-2 text-xl font-semibold tabular-nums tracking-tight ${valueClass}`}>{value}</p>
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

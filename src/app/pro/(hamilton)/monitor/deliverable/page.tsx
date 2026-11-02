// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

import type { ReactNode } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { makeDeliverable } from "@/lib/hamilton/decision-service";
import { DELIVERABLE_TITLES } from "@/lib/hamilton/workspace/deliverables";
import type { DeliverableKind } from "@/lib/hamilton/workspace/types";
import { LinkButton } from "@/components/hamilton/memo/memo";
import { PrintButton } from "@/components/hamilton/memo/PrintButton";
import { DeliverableView } from "@/components/hamilton/monitor/DeliverableView";
import "@/components/hamilton/dashboard/dashboard.css";

export const metadata: Metadata = { title: "Turn this into" };

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The title row Alerts and watches uses: a brick kicker, the title, one line, then the actions. */
function DeliverableHeader({ kicker, title, dek, actions }: { kicker: string; title: string; dek: string; actions: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="hd-label" style={{ color: "var(--fi-brick)" }}>{kicker}</p>
        <h1 className="m-0 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{title}</h1>
        <p className="m-0 text-sm text-warm-700">{dek}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>
    </header>
  );
}

/** A deliverable built from the decisions picked on Alerts and watches. */
export default async function DeliverablePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; ids?: string | string[]; instId?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?from=${encodeURIComponent("/pro/monitor")}`);

  const ids = Array.isArray(params.ids) ? params.ids : params.ids ? [params.ids] : [];
  const backHref = hrefWithInstitutionContext("/pro/monitor", params.instId ?? null);
  const result = await makeDeliverable(user, params.kind, ids);
  const kindTitle = DELIVERABLE_TITLES[params.kind as DeliverableKind] ?? "Deliverable";

  if (result.status !== 200 || "error" in result.body) {
    const message = "error" in result.body ? result.body.error : "The deliverable could not be built.";
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 text-warm-900">
        <DeliverableHeader kicker="Turn this into" title={kindTitle} dek={message} actions={<LinkButton href={backHref}>Back to your decisions</LinkButton>} />
      </div>
    );
  }

  const deliverable = result.body;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 text-warm-900">
      <DeliverableHeader
        kicker={`${deliverable.institutionName} · prepared ${longDate(deliverable.preparedOn)}`}
        title={deliverable.title}
        dek={`Built from ${deliverable.decisionIds.length} ${deliverable.decisionIds.length === 1 ? "decision" : "decisions"}. The prices your team tested and what each would do.`}
        actions={
          <>
            <LinkButton href={backHref}>Back to your decisions</LinkButton>
            <PrintButton />
          </>
        }
      />
      <div className="hd-card" style={{ padding: "24px 28px" }}>
        <DeliverableView deliverable={deliverable} />
      </div>
    </div>
  );
}

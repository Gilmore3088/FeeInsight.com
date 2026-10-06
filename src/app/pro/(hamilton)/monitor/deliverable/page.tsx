// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { makeDeliverable } from "@/lib/hamilton/decision-service";
import { DELIVERABLE_TITLES } from "@/lib/hamilton/workspace/deliverables";
import type { DeliverableKind } from "@/lib/hamilton/workspace/types";
import { LinkButton, MemoHeader, MemoPage } from "@/components/hamilton/memo/memo";
import { PrintButton } from "@/components/hamilton/memo/PrintButton";
import { DeliverableView } from "@/components/hamilton/monitor/DeliverableView";

export const metadata: Metadata = { title: "Turn this into" };

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** A deliverable built from the decisions picked on All changes. */
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
      <MemoPage>
        <MemoHeader kicker="Turn this into" title={kindTitle} dek={message} actions={<LinkButton href={backHref}>Back to your decisions</LinkButton>} />
      </MemoPage>
    );
  }

  const deliverable = result.body;
  return (
    <MemoPage>
      <MemoHeader
        kicker={`${deliverable.institutionName} · prepared ${longDate(deliverable.preparedOn)}`}
        title={deliverable.title}
        dek={`Built from ${deliverable.decisionIds.length} ${deliverable.decisionIds.length === 1 ? "decision" : "decisions"}. It sets out options and their consequences; it states a price only where your team chose one.`}
        actions={
          <>
            <LinkButton href={backHref}>Back to your decisions</LinkButton>
            <PrintButton />
          </>
        }
      />
      <DeliverableView deliverable={deliverable} />
    </MemoPage>
  );
}

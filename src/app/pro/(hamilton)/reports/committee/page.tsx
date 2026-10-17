// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { loadCommitteePacket } from "@/lib/hamilton/committee-packet-data";
import { packetFeeName } from "@/lib/hamilton/committee-packet";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { CommitteePacketView } from "@/components/hamilton/reports/CommitteePacket";
import { Callout, LinkButton, MemoHeader, MemoPage } from "@/components/hamilton/memo/memo";

export const metadata: Metadata = { title: "Pricing committee packet" };

const FEE_KEY = /^[a-z0-9_]+$/;

export default async function CommitteePacketPage({
  searchParams,
}: {
  searchParams: Promise<{ instId?: string; yield?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const { institution } = await resolveHamiltonInstitutionContext({
    userId: user.id,
    instId: params.instId ?? null,
    intent: "reports",
    persistUrlSelection: false,
  }).catch(() => ({ institution: null }));
  if (!institution) {
    return (
      <MemoPage>
        <MemoHeader kicker="Reports" title="Pricing committee packet" />
        <Callout>
          Choose a research institution first.{" "}
          <Link href="/pro/settings" className="font-medium text-terra-text underline">
            Choose an institution
          </Link>
        </Callout>
      </MemoPage>
    );
  }
  const yieldFee = params.yield && FEE_KEY.test(params.yield) ? params.yield : null;
  const packet = await loadCommitteePacket({
    userId: user.id,
    institutionId: institution.id,
    institutionName: institution.name,
    yieldFee,
  });
  if (!packet) {
    return (
      <MemoPage>
        <MemoHeader kicker="Reports" title="Pricing committee packet" actions={<LinkButton href={hrefWithInstitutionContext("/pro/reports", String(institution.id))}>Back to Reports</LinkButton>} />
        <p role="alert" className="rounded-md border border-terra p-4 text-sm text-terra-text">
          The packet could not be read just now. Reload the page to try again.
        </p>
      </MemoPage>
    );
  }
  const feeList = packet.feeCategories.map((category) => ({ category, name: packetFeeName(category) }));
  const hrefFor = (over: Record<string, string | null>) => {
    const q = new URLSearchParams();
    q.set("instId", String(institution.id));
    if (yieldFee) q.set("yield", yieldFee);
    for (const [k, v] of Object.entries(over)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    return `/pro/reports/committee?${q.toString()}`;
  };
  return (
    <CommitteePacketView
      packet={packet}
      hrefFor={hrefFor}
      fees={feeList}
      selected={{ yieldFee: packet.priceYield?.feeCategory ?? yieldFee }}
    />
  );
}

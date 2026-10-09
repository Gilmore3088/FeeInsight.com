import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AgentHandoffStrip } from "@/components/agent-console/agent-handoff-strip";
import { requireAuth } from "@/lib/auth";
import { formatAdminDateTime } from "@/lib/admin-time";
import { getKnoxStatus, type KnoxStatus } from "@/lib/data-store/knox-status";
import { logReadFailure } from "@/lib/admin-read-failure";
import { GoldStandardView } from "../verify/page";

export const dynamic = "force-dynamic";

/**
 * Knox's human work is the gold-standard audit. The Knox decisions queue (rejection verdicts
 * awaiting confirm/override, 726 of 746 from the August legacy import) was retired by James on
 * Oct 9: an override could not publish, so the queue asked for work that changed nothing. Its
 * records stay in `agent_messages` and `knox_overrides`; old queue links land here.
 */
export default async function KnoxPage() {
  await requireAuth("view");
  const status = await getKnoxStatus().catch((error) => {
    logReadFailure("Knox status", error);
    return null;
  });

  return (
    <div>
      <header className="mb-5">
        <Breadcrumbs items={[{ label: "Atlas", href: "/admin" }, { label: "Knox" }]} />
        <p className="admin-eyebrow mt-3">Agent · Extract + Review</p>
        <h1 className="admin-display-title mt-1">Knox</h1>
        <KnoxHeadline status={status} />
        <p className="admin-lede mt-2">
          Knox reads each fee schedule Rosetta turned into text and writes down every fee it finds. Darwin checks those
          fees next; nothing here needs you unless a spot check below looks wrong.
        </p>
        <Link href="/admin/knox/labels" className="admin-meta mt-2 inline-block underline">
          Label this week&apos;s contested fee names
        </Link>
      </header>

      <div className="mb-7">
        <AgentHandoffStrip
          steps={[
            {
              label: "Input",
              title: "Rosetta text",
              detail: "Normalized source artifacts provide stable extraction input.",
              href: "/admin/rosetta",
            },
            {
              label: "Current",
              title: "Knox extracts",
              detail: "Create conservative raw observations from the read text.",
              href: "/admin/knox",
              current: true,
            },
            {
              label: "Next",
              title: "Darwin verifies",
              detail: "Promote source-grounded rows into verified observations.",
              href: "/admin/darwin",
            },
            {
              label: "Publish",
              title: "Hamilton publishes",
              detail: "Move eligible verified rows into product read models.",
              href: "/admin/data",
            },
          ]}
        />
      </div>

      <section aria-labelledby="knox-spot-check">
        <h2 id="knox-spot-check" className="admin-section-title">Spot-check Knox against the largest banks</h2>
        <p className="mt-1 text-xs text-gray-500">
          The biggest institutions with extracted fees. Open a bank&apos;s schedule and compare it with what Knox wrote down.
        </p>
        <GoldStandardView embedded />
      </section>
    </div>
  );
}

/** The key number first: what Knox did in the last 24 hours and what waits for Darwin. */
function KnoxHeadline({ status }: { status: KnoxStatus | null }) {
  if (!status) {
    return <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">Couldn&apos;t read Knox&apos;s numbers just now; reload to try again.</p>;
  }
  const n = (value: number) => value.toLocaleString("en-US");
  return (
    <div className="mt-2">
      <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {n(status.fees24h)} fees from {n(status.documents24h)} documents in the last 24 hours
      </p>
      <p className="admin-meta mt-0.5">
        {n(status.waitingForDarwin)} wait for Darwin
        {status.lastStep ? ` · last step ${status.lastStep.status} ${formatAdminDateTime(status.lastStep.at)}` : " · no finished step yet"}
      </p>
    </div>
  );
}

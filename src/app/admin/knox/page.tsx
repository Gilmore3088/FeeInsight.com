import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AgentHandoffStrip } from "@/components/agent-console/agent-handoff-strip";
import { requireAuth } from "@/lib/auth";
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

  return (
    <div>
      <header className="mb-5">
        <Breadcrumbs items={[{ label: "Atlas", href: "/admin" }, { label: "Knox" }]} />
        <p className="admin-eyebrow mt-3">Agent · Extract + Review</p>
        <h1 className="admin-display-title mt-1">Knox</h1>
        <p className="admin-lede mt-2">Knox extracts conservative raw fee observations from Rosetta text and keeps human work anomaly-only.</p>
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

      <GoldStandardView embedded />
    </div>
  );
}

export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { getCrewFeed, getCrewStatus } from "@/lib/agents/crew";
import { getSpendSummary } from "@/lib/data-store/console-spend";
import { CrewLive } from "../crew-live";
import { RoomHeader, RoomScreens, Unreadable } from "../room-hub";
import { SpendPanel } from "../spend-panel";

/** The Agents room: the six agents live, what each costs, and every agent screen. */
export default async function AgentsRoomPage() {
  await requireAuth("view");
  const [crew, feed, spend] = await Promise.all([
    getCrewStatus().catch((error) => {
      console.error("Agents room crew status failed", error);
      return [];
    }),
    getCrewFeed({ limit: 40 }).catch((error) => {
      console.error("Agents room crew feed failed", error);
      return [];
    }),
    getSpendSummary().catch((error) => {
      console.error("Agents room spend failed", error);
      return null;
    }),
  ]);

  return (
    <div className="space-y-8 pb-10">
      <RoomHeader room="agents">
        <Link href="/admin/live" prefetch={false} className="text-xs font-semibold text-[var(--brand-primary)]">
          Watch banks move through the agents
        </Link>
      </RoomHeader>
      <CrewLive initialCrew={crew} initialFeed={feed} />
      {spend ? <SpendPanel spend={spend} title="What each agent is spending" /> : <Unreadable what="Agent spend" />}
      <RoomScreens room="agents" />
    </div>
  );
}

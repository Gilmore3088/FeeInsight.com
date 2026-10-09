import { unstable_cache } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { getFeedFreshness } from "@/lib/data-store/feed-freshness";
import { DataFeedsPanel } from "../data-feeds-panel";
import { DataOperations } from "./data-operations";
import { RoomHeader, Unreadable } from "../room-hub";

export const dynamic = "force-dynamic";

// Feed and report dates move a few times a day; the call-report scan is slow, so it refreshes every five minutes.
const getCachedFeedFreshness = unstable_cache(getFeedFreshness, ["admin", "feed-freshness"], {
  revalidate: 300,
});

/** The Data room: what is live, how fresh each feed is, and the jobs that keep it right. Its screens are in the room menu. */
export default async function DataPage() {
  await requireAuth("view");
  const freshness = await getCachedFeedFreshness().catch((error) => {
    console.error("Data room feed freshness failed", error);
    return null;
  });
  return (
    <div className="space-y-8">
      <RoomHeader room="data" />

      {freshness ? (
        <DataFeedsPanel freshness={freshness} now={new Date().toISOString()} />
      ) : (
        <Unreadable what="Data feed and report dates" />
      )}

      <DataOperations />
    </div>
  );
}

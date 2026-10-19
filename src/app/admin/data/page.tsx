import { unstable_cache } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { getFeedFreshness } from "@/lib/data-store/feed-freshness";
import { DataFeedsPanel } from "../data-feeds-panel";
import { DataOperations } from "./data-operations";
import { PileList, RoomHeader, Unreadable } from "../room-hub";
import { VitalsRow } from "../today-panels";
import { readDataRoomCounts } from "@/lib/data-store/data-room";
import { dataRoomPiles, dataRoomVitals } from "@/lib/admin-data-room";

export const dynamic = "force-dynamic";

// Feed and report dates move a few times a day; the call-report scan is slow, so it refreshes every five minutes.
const getCachedFeedFreshness = unstable_cache(getFeedFreshness, ["admin", "feed-freshness"], {
  revalidate: 300,
});
// About 0.8 s on production; the counts move with publishes, so ten minutes is fresh enough.
const getCachedDataRoomCounts = unstable_cache(() => readDataRoomCounts(), ["admin", "data-room-counts"], {
  revalidate: 600,
});

/** The Data room (#1122 step 5): what we hold, the data piles a data change clears, how fresh each feed is, and the jobs that keep it right. Its screens are in the room menu. */
export default async function DataPage() {
  await requireAuth("operate");
  const [freshness, counts] = await Promise.all([
    getCachedFeedFreshness().catch((error) => {
      console.error("Data room feed freshness failed", error);
      return null;
    }),
    getCachedDataRoomCounts().catch((error) => {
      console.error("Data room counts failed", error);
      return null;
    }),
  ]);
  return (
    <div className="space-y-8">
      <RoomHeader room="data" />

      <VitalsRow vitals={dataRoomVitals(counts)} />

      <section aria-label="Data piles" className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Data to fix</h2>
        <PileList piles={dataRoomPiles(counts)} />
      </section>

      {freshness ? (
        <DataFeedsPanel freshness={freshness} now={new Date().toISOString()} />
      ) : (
        <Unreadable what="Data feed and report dates" />
      )}

      <DataOperations />
    </div>
  );
}

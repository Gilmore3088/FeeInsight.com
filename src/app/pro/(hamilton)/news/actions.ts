"use server";

import { getCurrentUser } from "@/lib/auth";
import { REG_NEWS_PARTITION, REG_NEWS_SOURCE } from "@/lib/agents/magellan/registry/reg-news";
import { startRegistryRun } from "@/lib/agents/registry-scheduler";

/**
 * Refresh queues the regulator press feeds' registry run (#2233), the same loader the daily
 * schedule runs: its fetch, dedupe, partition receipt, pause controls and run ledger. Nothing is
 * fetched here; the tick runs it, and a run already queued is reused rather than started twice.
 */
export async function refreshFeeds(): Promise<{ runId: number; status: string; reused: boolean }> {
  const user = await getCurrentUser();
  // Feed ingestion writes shared data: operators only.
  if (!user || (user.role !== "admin" && user.role !== "analyst")) {
    throw new Error("Unauthorized");
  }
  const started = await startRegistryRun({
    source: REG_NEWS_SOURCE,
    partitionKey: REG_NEWS_PARTITION,
    triggeredBy: `admin:${user.id}`,
    triggerSource: "admin",
  });
  return { runId: started.run.id, status: started.run.status, reused: started.reused };
}

import Link from "next/link";
import {
  listRecentThreads,
  type MessageThread,
} from "@/lib/data-store/agent-console";
import { ScreenHeader } from "../../room-hub";

export const dynamic = "force-dynamic";

function formatTs(ts: string): string {
  if (!ts) return "—";
  return ts.replace("T", " ").slice(0, 19);
}

export default async function AgentsMessagesPage() {
  let threads: MessageThread[] = [];
  let loadError: string | null = null;

  try {
    threads = await listRecentThreads(72, 50);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <section className="flex flex-col gap-3">
      <ScreenHeader title="Messages" lede="What the agents said to each other, grouped by conversation." />
      {loadError && (
        <div className="admin-card p-4 text-[12px] text-red-600 dark:text-red-400">
          Failed to load threads: {loadError}
        </div>
      )}

      {threads.length === 0 && !loadError && (
        <div className="admin-card p-6 text-center text-sm text-gray-500 dark:text-gray-400">
          No agent message threads in the last 72 hours.
        </div>
      )}

      {threads.length > 0 && (
        <div className="admin-card overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12px]">
            <thead>
              <tr className="bg-gray-50/80 dark:bg-white/[0.02] text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th className="text-left px-4 py-2.5">Started</th>
                <th className="text-left px-4 py-2.5">Correlation</th>
                <th className="text-left px-4 py-2.5">State</th>
                <th className="text-left px-4 py-2.5">Intent</th>
                <th className="text-right px-4 py-2.5">Rounds</th>
                <th className="text-left px-4 py-2.5">Participants</th>
              </tr>
            </thead>
            <tbody>
              {threads.map((t) => (
                <tr
                  key={t.correlation_id}
                  className="border-t border-black/[0.04] dark:border-white/[0.04] hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-4 py-2.5 tabular-nums text-gray-500">
                    {formatTs(t.started_at)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px]">
                    <Link
                      href={`/admin/agents/replay?correlation=${encodeURIComponent(t.correlation_id)}`}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {t.correlation_id.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-gray-100 dark:bg-white/[0.05] text-gray-700 dark:text-gray-200">
                      {t.latest_state || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 dark:text-gray-200">
                    {t.latest_intent || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {t.round_count}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-[11px]">
                    {t.participants.join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

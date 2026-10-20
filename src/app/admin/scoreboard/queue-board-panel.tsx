import type { QueueBoard } from "@/lib/agents/queue-board";

const n = (value: number | null | undefined) => (value == null ? "—" : value.toLocaleString("en-US"));

/**
 * Every pile in the pipeline with its owner, size, oldest item and alarms (#1108), from the
 * newest scoreboard snapshot (`detail.queues`). The registry is `src/lib/agents/queue-registry.ts`.
 */
export function QueueBoardPanel({ board, date }: { board: QueueBoard | null; date: string | null }) {
  return (
    <section className="space-y-3" aria-labelledby="piles-title">
      <div>
        <h2 id="piles-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">Piles</h2>
        <p className="text-xs text-gray-500">
          Every queue in the pipeline, its owner and its alarms{date ? ` (${date})` : ""}. An alarm fires when a pile holds anything older than its limit, or is bigger than on the stored day its growth window back.
        </p>
      </div>
      {!board ? (
        <p className="admin-card p-4 text-xs text-gray-500">Not measured yet: the next daily scoreboard records the piles.</p>
      ) : (
        <div className="admin-card overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-gray-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Pile</th>
                <th className="px-3 py-2 font-semibold">Owner</th>
                <th className="px-3 py-2 text-right font-semibold">Size</th>
                <th className="px-3 py-2 text-right font-semibold">Oldest</th>
                <th className="px-3 py-2 font-semibold">Alarm</th>
              </tr>
            </thead>
            <tbody>
              {board.queues.map((queue) => (
                <tr key={queue.key} className="border-t border-gray-100 align-top dark:border-white/[0.06]">
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900 dark:text-gray-100">{queue.label}</p>
                    <p className="text-[11px] text-gray-500">{queue.wayOut}</p>
                  </td>
                  <td className="px-3 py-2 capitalize">{queue.owner}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{queue.size == null ? "Could not be read" : n(queue.size)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {queue.oldestDays == null ? "—" : `${n(queue.oldestDays)} days`}
                    <span className="block text-[10px] text-gray-400">limit {queue.ageLimitDays}</span>
                  </td>
                  <td className="px-3 py-2">
                    {queue.size == null ? (
                      <span className="text-gray-400">Unknown</span>
                    ) : queue.alarms.length === 0 ? (
                      <span className="text-emerald-700 dark:text-emerald-400">
                        None{queue.growthBase ? "" : ` (growth needs ${queue.growthWindowDays} stored days)`}
                      </span>
                    ) : (
                      <span className="font-semibold text-red-700 dark:text-red-400">
                        {queue.alarms.map((alarm) => alarm === "age"
                          ? `Older than ${queue.ageLimitDays} days`
                          : `Grew from ${n(queue.growthBase?.size)} on ${queue.growthBase?.date}`).join("; ")}
                      </span>
                    )}
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

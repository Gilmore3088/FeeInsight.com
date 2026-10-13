import type { HoldGroup } from "@/lib/agents/darwin/held-queue";
import { formatAdminDateTime } from "@/lib/admin-time";
import { getCachedHoldGroups } from "@/lib/console/held-queue-cache";

/** Darwin's held fees by reason (#1115 step 1): count, oldest, an example and the way out. */
export async function HeldQueue() {
  let groups: HoldGroup[] | null;
  try {
    groups = await getCachedHoldGroups();
  } catch (error) {
    console.error("Darwin held queue could not be read", error);
    groups = null;
  }
  const total = groups?.reduce((sum, group) => sum + group.count, 0) ?? 0;
  return (
    <section aria-label="Held fees" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Held fees, by reason</h2>
        {groups ? <p className="text-xs text-gray-500">{total.toLocaleString("en-US")} held</p> : null}
      </div>
      {groups == null ? (
        <p className="text-xs text-red-700 dark:text-red-300">The held fees could not be read.</p>
      ) : groups.length === 0 ? (
        <p className="text-xs text-gray-500">Darwin holds no fees.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <li key={group.cause} className="admin-card space-y-1.5 p-4">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{group.label}</p>
              <p className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                {group.count.toLocaleString("en-US")} <span className="text-xs font-normal text-gray-500">fees</span>
              </p>
              {group.oldest ? <p className="text-xs text-gray-500">Oldest: {formatAdminDateTime(group.oldest)}</p> : null}
              {group.example ? (
                <p className="truncate text-xs text-gray-500">
                  e.g. {group.example.feeName}
                  {group.example.amount != null ? ` $${group.example.amount.toFixed(2)}` : ""}
                  {group.example.institution ? ` · ${group.example.institution}` : ""}
                </p>
              ) : null}
              <p className={`text-xs ${group.hasExit ? "text-gray-600 dark:text-gray-400" : "font-semibold text-amber-700 dark:text-amber-400"}`}>
                Way out: {group.wayOut}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

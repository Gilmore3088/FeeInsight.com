import { unstable_cache } from "next/cache";
import { sql } from "@/lib/data-store/connection";
import { readKnoxHoldGroups, type KnoxHoldGroup } from "@/lib/agents/knox/held-queue";
import { formatAdminDateTime } from "@/lib/admin-time";

const getCachedKnoxHolds = unstable_cache(() => readKnoxHoldGroups(sql), ["admin", "knox-held-lines"], { revalidate: 600 });

/** Knox's held lines by group (#1102): count, set aside, new this week, oldest, an example, the owner and the way out. */
export async function KnoxHeldLines() {
  let groups: KnoxHoldGroup[] | null;
  try {
    groups = await getCachedKnoxHolds();
  } catch (error) {
    console.error("Knox held lines could not be read", error);
    groups = null;
  }
  const total = groups?.reduce((sum, group) => sum + group.count, 0) ?? 0;
  return (
    <section aria-label="Held lines" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Held lines, by why Knox held them</h2>
        {groups ? <p className="text-xs text-gray-500">{total.toLocaleString("en-US")} held</p> : null}
      </div>
      {groups == null ? (
        <p className="text-xs text-red-700 dark:text-red-300">The held lines could not be read.</p>
      ) : groups.length === 0 ? (
        <p className="text-xs text-gray-500">Knox holds no lines.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <li key={group.shape} className="admin-card space-y-1.5 p-4">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{group.label}</p>
              <p className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                {group.count.toLocaleString("en-US")} <span className="text-xs font-normal text-gray-500">lines</span>
              </p>
              <p className="text-xs text-gray-500">
                {group.newThisWeek.toLocaleString("en-US")} new in 7 days
                {group.setAside > 0 ? ` · ${group.setAside.toLocaleString("en-US")} set aside` : ""}
                {group.rereadThrice > 0 && group.rereadThrice !== group.setAside
                  ? ` · ${group.rereadThrice.toLocaleString("en-US")} re-read by 3+ rules versions`
                  : ""}
                {group.oldest ? ` · oldest ${formatAdminDateTime(group.oldest)}` : ""}
              </p>
              {group.example ? (
                <p className="truncate text-xs text-gray-500">
                  e.g. {group.example.feeName}
                  {group.example.amount != null ? ` $${group.example.amount.toFixed(2)}` : ""}
                </p>
              ) : null}
              <p className="text-xs text-gray-600 dark:text-gray-400">Owner: {group.owner}</p>
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

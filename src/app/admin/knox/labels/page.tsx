export const dynamic = "force-dynamic";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireAuth } from "@/lib/auth";
import { sql } from "@/lib/data-store/connection";
import { loadLabelQueue, NO_CATEGORY_LABEL } from "@/lib/agents/knox/label-queue";
import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import { saveNameLabelAction } from "./actions";

export default async function KnoxLabelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAuth("view");
  const params = await searchParams;
  const queue = await loadLabelQueue(sql);

  return (
    <div>
      <header className="mb-5">
        <Breadcrumbs items={[{ label: "Atlas", href: "/admin" }, { label: "Knox", href: "/admin/knox" }, { label: "Labels" }]} />
        <p className="admin-eyebrow mt-3">Agent · Extract</p>
        <h1 className="admin-display-title mt-1">This week&apos;s fee names to label</h1>
        <p className="admin-lede mt-2">
          Names the category checks keep rejecting, or judge both ways, most-judged first. Pick the category each one
          belongs in. Knox files the name that way from its next extract; no live fee changes.
        </p>
      </header>

      {params.message ? <p className="admin-meta mb-4" role="status">{params.message}</p> : null}

      {queue.length === 0 ? (
        <p className="admin-meta">Nothing to label right now.</p>
      ) : (
        <ol className="divide-y divide-black/[0.06] border-y border-black/[0.06] dark:divide-white/[0.06] dark:border-white/[0.06]">
          {queue.map((item) => (
            <li key={item.name} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{item.example}</p>
                <p className="admin-meta mt-1">
                  {item.reason === "never_verified" ? "Rejected at" : "Judged both ways at"} {item.banks.toLocaleString("en-US")} banks:{" "}
                  {item.verdicts
                    .map((verdict) => `${getDisplayName(verdict.canonicalKey)} (${verdict.rightBanks} right, ${verdict.wrongBanks} wrong)`)
                    .join("; ")}
                </p>
              </div>
              <form action={saveNameLabelAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="name" value={item.example} />
                <label className="sr-only" htmlFor={`label-${item.name}`}>Category for {item.example}</label>
                <select
                  id={`label-${item.name}`}
                  name="canonical_key"
                  defaultValue={item.verdicts.find((verdict) => verdict.rightBanks > 0)?.canonicalKey ?? NO_CATEGORY_LABEL}
                  className="min-h-8 min-w-0 flex-1 rounded-md border border-black/[0.1] bg-transparent px-2 text-sm dark:border-white/[0.12]"
                >
                  <option value={NO_CATEGORY_LABEL}>No category fits</option>
                  {Object.entries(FEE_FAMILIES).map(([family, keys]) => (
                    <optgroup key={family} label={family}>
                      {keys.map((key) => (
                        <option key={key} value={key}>{getDisplayName(key)}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  type="submit"
                  className="inline-flex min-h-8 items-center rounded-md bg-gray-900 px-3 text-xs font-semibold text-white hover:bg-gray-800 dark:bg-white/[0.14] dark:hover:bg-white/[0.2]"
                >
                  Save
                </button>
              </form>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

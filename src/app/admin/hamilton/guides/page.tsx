export const dynamic = "force-dynamic";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { listGuidesForAdmin, type StoredGuide } from "@/lib/data-store/guides";
import { getCachedFeeCategorySummaries } from "@/lib/data-store/fee-cache";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { guideText, guideWordCount, resolveTokens } from "@/lib/guides";
import { GuideActions, type GuideActionRow } from "./guide-actions";

const STATUS_STYLES: Record<string, string> = {
  draft: "border-gray-200 bg-gray-50 text-gray-700",
  in_review: "border-blue-200 bg-blue-50 text-blue-800",
  regulatory_review: "border-amber-200 bg-amber-50 text-amber-800",
  published: "border-emerald-200 bg-emerald-50 text-emerald-800",
  archived: "border-gray-200 bg-white text-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  regulatory_review: "Regulatory review",
  published: "Published",
  archived: "Archived",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function AdminGuidesPage() {
  await requireAuth("view");

  let guides: StoredGuide[] = [];
  let loadError: string | null = null;
  try {
    guides = await listGuidesForAdmin();
  } catch (error) {
    // The tables may not exist yet in an environment that has not run the migration.
    loadError = error instanceof Error ? error.message : String(error);
  }

  const summaries = guides.length > 0 ? await getCachedFeeCategorySummaries() : [];

  // Resolve every token now so a reviewer sees what the reader would see, and a guide
  // citing data that no longer exists is caught before publish rather than after.
  const rows: (GuideActionRow & {
    guide: StoredGuide;
    wordCount: number;
    unresolved: string[];
  })[] = guides.map((guide) => {
    const unresolved: string[] = [];
    for (const text of guideText(guide)) {
      for (const token of resolveTokens(text, summaries).unresolved) {
        unresolved.push(token.raw);
      }
    }
    return {
      id: guide.id,
      slug: guide.slug,
      title: guide.title,
      status: guide.status,
      carriesRegulatoryContent: Boolean(guide.carriesRegulatoryContent),
      regulatoryApprovedBy: guide.regulatoryApprovedBy,
      regulatoryApprovedAt: guide.regulatoryApprovedAt,
      unresolvedTokenCount: unresolved.length,
      guide,
      wordCount: guideWordCount(guide),
      unresolved: [...new Set(unresolved)],
    };
  });

  const awaitingHuman = rows.filter((r) =>
    ["draft", "in_review", "regulatory_review"].includes(r.status),
  ).length;
  const stale = rows.filter((r) => r.guide.staleSince !== null).length;

  return (
    <div className="admin-content space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/admin" },
            { label: "Hamilton", href: "/admin/hamilton" },
            { label: "Guides" },
          ]}
        />
        <h1 className="text-xl font-bold tracking-tight text-gray-900">Consumer Guides</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {rows.length} guides &middot; {awaitingHuman} awaiting a human
          {stale > 0 && <> &middot; {stale} flagged stale after a benchmark move</>}
        </p>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
        <strong className="font-semibold">Regulatory sign-off.</strong> Guides that state
        regulatory facts — Regulation E opt-in, Regulation DD disclosure, CFPB routes,
        state unclaimed property — cannot be published until an approval is recorded
        against their current text. Editing a guide clears its approval: a rewrite is not
        the text that was approved, and an agent never inherits a human&rsquo;s sign-off.
      </div>

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
          <strong className="font-semibold">Guides are not readable.</strong> This
          environment may not have run the <code>consumer_guides</code> migration yet.
          <span className="mt-1 block font-mono text-[11px] text-red-700">{loadError}</span>
        </div>
      )}

      {!loadError && rows.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center">
          <p className="text-sm text-gray-600">
            No guides stored yet. The typed catalog in <code>src/lib/guides/</code> is
            still serving the public pages.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[900px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Guide
                </th>
                <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Status
                </th>
                <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Tier
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Words
                </th>
                <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Reviewed
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Views
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-gray-100 last:border-0 align-top">
                  <td className="px-4 py-3">
                    <Link
                      href={`/guides/${row.slug}`}
                      className="font-semibold text-gray-900 hover:text-[#C44B2E]"
                    >
                      {row.title}
                    </Link>
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      {getDisplayName(row.guide.primaryCategory)} &middot; {row.guide.author}
                      {row.guide.generatedBy && <> &middot; {row.guide.generatedBy}</>}
                    </div>
                    {row.unresolved.length > 0 && (
                      <div className="mt-1 text-[11px] text-red-700">
                        Unresolved: {row.unresolved.slice(0, 4).join(", ")}
                        {row.unresolved.length > 4 && ` +${row.unresolved.length - 4} more`}
                      </div>
                    )}
                    {row.guide.staleSince && (
                      <div className="mt-1 text-[11px] text-amber-700">
                        Stale since {formatDate(row.guide.staleSince)}
                        {row.guide.staleReason && ` — ${row.guide.staleReason}`}
                      </div>
                    )}
                    {row.carriesRegulatoryContent && (
                      <div className="mt-1 text-[11px] text-gray-600">
                        {row.regulatoryApprovedAt ? (
                          <>
                            Regulatory approved by {row.regulatoryApprovedBy} on{" "}
                            {formatDate(row.regulatoryApprovedAt)}
                          </>
                        ) : (
                          <span className="text-amber-700">
                            Regulatory content not yet approved
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${
                        STATUS_STYLES[row.status] ?? STATUS_STYLES.draft
                      }`}
                    >
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {row.guide.audience} / {row.guide.accessTier}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                    {row.wordCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatDate(row.guide.reviewedAt)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                    {row.guide.viewCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <GuideActions guide={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

"use client";

import { Suspense } from "react";
import { SortableTable, type Column } from "@/components/sortable-table";
import { timeAgo } from "@/lib/format";
import type { Article } from "@/lib/data-store/articles";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-500 dark:bg-white/[0.08] dark:text-gray-400",
  published: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
  archived: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
};

const CATEGORY_LABELS: Record<string, string> = {
  guide: "Guide",
  analysis: "Analysis",
  report: "Report",
  brief: "Brief",
};

type ArticleRow = Article & Record<string, unknown>;

export function ArticlesTable({
  articles,
  actionsById,
}: {
  articles: Article[];
  /** Server-rendered action cells keyed by article id (functions cannot cross the client boundary). */
  actionsById: Record<string, React.ReactNode>;
}) {
  const columns: Column<ArticleRow>[] = [
    {
      key: "title",
      label: "Title",
      sortable: true,
      format: (_, row) => (
        <div>
          <span className="font-medium text-gray-900 dark:text-gray-100 text-xs">
            {row.title as string}
          </span>
          {row.subtitle && (
            <p className="text-[11px] text-gray-400 mt-0.5 truncate max-w-xs">{row.subtitle as string}</p>
          )}
          <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-0.5">/{row.slug as string}</p>
        </div>
      ),
    },
    {
      key: "category",
      label: "Category",
      sortable: true,
      format: (v) => (
        <span className="text-xs text-gray-500">
          {CATEGORY_LABELS[v as string] || (v as string)}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      format: (v) => (
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[v as string] || STATUS_COLORS.draft}`}>
          {v as string}
        </span>
      ),
    },
    {
      key: "view_count",
      label: "Views",
      align: "right",
      sortable: true,
      format: (v) => <span className="tabular-nums text-xs text-gray-500">{v as number}</span>,
    },
    {
      key: "updated_at",
      label: "Updated",
      sortable: true,
      format: (v) => (
        <span className="text-xs text-gray-500">
          {timeAgo(v instanceof Date ? v.toISOString() : v as string)}
        </span>
      ),
    },
    {
      key: "id",
      label: "Actions",
      align: "right",
      sortable: false,
      format: (_, row) => actionsById[String((row as unknown as Article).id)] ?? null,
    },
  ];

  if (articles.length === 0) {
    return (
      <div className="admin-card px-4 py-12 text-center text-gray-500">
        No articles yet. Use the Content Writer agent to generate your first article.
      </div>
    );
  }

  return (
    <Suspense fallback={null}>
      <SortableTable
        columns={columns}
        rows={articles as ArticleRow[]}
        rowKey={(r) => String(r.id)}
        defaultSort="title"
        defaultDir="asc"
        pageSize={50}
      />
    </Suspense>
  );
}

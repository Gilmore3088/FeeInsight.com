export const dynamic = "force-dynamic";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { getArticles } from "@/lib/data-store/articles";
import { ensureResearchTables } from "@/lib/research/history";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ArticlesTable } from "@/components/articles-table";
import { ArticleActions } from "./article-actions";

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string }>;
}) {
  await requireAuth("view");
  await ensureResearchTables();

  const params = await searchParams;
  const { articles, total } = await getArticles({
    status: params.status || undefined,
    category: params.category || undefined,
  });

  return (
    <div className="admin-content space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/admin" },
            { label: "Hamilton Research", href: "/admin/hamilton/research" },
            { label: "Articles" },
          ]}
        />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">
              Articles
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {total} articles &middot; Manage published research content
            </p>
          </div>
          <Link
            href="/admin/hamilton/research/content-writer"
            className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-gray-800 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Article
          </Link>
        </div>
      </div>

      {/* Status filters */}
      <div className="flex gap-1">
        {[
          { value: "", label: "All" },
          { value: "draft", label: "Drafts" },
          { value: "published", label: "Published" },
          { value: "archived", label: "Archived" },
        ].map((f) => (
          <Link
            key={f.value}
            href={`/admin/hamilton/research/articles${f.value ? `?status=${f.value}` : ""}`}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
              (params.status || "") === f.value
                ? "bg-gray-900 text-white dark:bg-white/10 dark:text-gray-100"
                : "text-gray-500 hover:text-gray-700 border border-gray-200 dark:border-white/10 dark:text-gray-400"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <ArticlesTable
        articles={articles}
        actionsById={Object.fromEntries(
          articles.map((article) => [String(article.id), <ArticleActions key={article.id} article={article} />]),
        )}
      />
    </div>
  );
}

export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getArticleById } from "@/lib/data-store/articles";
import { ensureResearchTables } from "@/lib/research/history";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { renderArticleMarkdown } from "@/lib/article-markdown";
import { ArticleActions } from "../article-actions";
import { ArticleTextEditor } from "./article-text-editor";

/**
 * One article as readers will see it, whatever its status, so a draft can be read before
 * it is published. Publish, archive and delete sit at the top; the text can be corrected
 * below it.
 */
export default async function ArticlePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth("view");
  await ensureResearchTables();
  const { id } = await params;
  const articleId = Number(id);
  if (!Number.isInteger(articleId)) notFound();
  const article = await getArticleById(articleId);
  if (!article) notFound();

  return (
    <div className="admin-content space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/admin" },
            { label: "Hamilton Research", href: "/admin/hamilton/research" },
            { label: "Articles", href: "/admin/hamilton/research/articles" },
            { label: article.status === "draft" ? "Draft preview" : "Preview" },
          ]}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] text-gray-500">
            {article.status === "draft"
              ? `Draft. Not on the site until you publish it; it will go live at /research/articles/${article.slug}.`
              : article.status === "published"
                ? "Published."
                : "Archived. Not on the site."}
          </p>
          <ArticleActions article={article} showPreview={false} />
        </div>
      </div>

      <article className="max-w-2xl rounded-lg border border-gray-200 bg-white px-5 py-6 dark:border-white/10 dark:bg-white/[0.02]">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">{article.title}</h1>
        {article.subtitle && <p className="mt-2 text-[15px] text-gray-500">{article.subtitle}</p>}
        <div
          className="prose prose-slate mt-6 max-w-none prose-headings:tracking-tight prose-h2:text-lg prose-p:text-[15px] prose-li:text-[15px] prose-table:text-sm dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: renderArticleMarkdown(article.content) }}
        />
      </article>

      <ArticleTextEditor id={article.id} title={article.title} subtitle={article.subtitle} content={article.content} />

      <Link href="/admin/hamilton/research/articles" className="inline-block text-[12px] text-gray-500 hover:text-gray-800">
        &larr; All articles
      </Link>
    </div>
  );
}

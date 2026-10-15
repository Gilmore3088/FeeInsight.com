import { notFound } from "next/navigation";
import { getArticleBySlug } from "@/lib/data-store/articles";

/**
 * A missing or unpublished article answers 404 (#1267). The check sits in this layout, above
 * the page's loading skeleton: once a skeleton streams, the status is fixed at 200.
 */
export default async function ArticleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article || article.status !== "published") notFound();
  return children;
}

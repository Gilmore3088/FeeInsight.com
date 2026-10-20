import { notFound } from "next/navigation";
import { loadPublishedArticle } from "./load-article";

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
  if (!(await loadPublishedArticle(slug))) notFound();
  return children;
}

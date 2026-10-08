"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateArticleAction, deleteArticleAction } from "./actions";
import type { Article } from "@/lib/data-store/articles";

export function ArticleActions({ article, showPreview = true }: { article: Article; showPreview?: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handlePublish() {
    startTransition(async () => {
      await updateArticleAction(article.id, { status: "published" });
      router.refresh();
    });
  }

  function handleArchive() {
    startTransition(async () => {
      await updateArticleAction(article.id, { status: "archived" });
      router.refresh();
    });
  }

  function handleDraft() {
    startTransition(async () => {
      await updateArticleAction(article.id, { status: "draft" });
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm(`Delete "${article.title}"? This cannot be undone.`)) return;
    startTransition(async () => {
      await deleteArticleAction(article.id);
      router.refresh();
    });
  }

  return (
    <div className={`flex gap-1 justify-end ${pending ? "opacity-50" : ""}`}>
      {showPreview && article.status !== "published" && (
        <a
          href={`/admin/hamilton/research/articles/${article.id}`}
          className="rounded px-2 py-1 text-[10px] font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 transition-colors"
        >
          Preview
        </a>
      )}
      {article.status === "draft" && (
        <button
          onClick={handlePublish}
          disabled={pending}
          className="rounded px-2 py-1 text-[10px] font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 transition-colors"
        >
          Publish
        </button>
      )}
      {article.status === "published" && (
        <>
          <a
            href={`/research/articles/${article.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded px-2 py-1 text-[10px] font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 transition-colors"
          >
            View
          </a>
          <button
            onClick={handleArchive}
            disabled={pending}
            className="rounded px-2 py-1 text-[10px] font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400 transition-colors"
          >
            Archive
          </button>
        </>
      )}
      {article.status === "archived" && (
        <button
          onClick={handleDraft}
          disabled={pending}
          className="rounded px-2 py-1 text-[10px] font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.08] dark:text-gray-400 transition-colors"
        >
          Restore
        </button>
      )}
      <button
        onClick={handleDelete}
        disabled={pending}
        className="rounded px-2 py-1 text-[10px] font-medium bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 transition-colors"
      >
        Delete
      </button>
    </div>
  );
}

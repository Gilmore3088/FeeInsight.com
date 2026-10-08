"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateArticleAction } from "../actions";

/** Collapsed by default: open it to correct the title, subtitle or text before publishing. */
export function ArticleTextEditor(props: { id: number; title: string; subtitle: string | null; content: string }) {
  const [title, setTitle] = useState(props.title);
  const [subtitle, setSubtitle] = useState(props.subtitle ?? "");
  const [content, setContent] = useState(props.content);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    startTransition(async () => {
      const result = await updateArticleAction(props.id, { title, subtitle: subtitle || null, content });
      setMessage(result.success ? "Saved." : result.error ?? "Could not save.");
      if (result.success) router.refresh();
    });
  }

  return (
    <details className="max-w-2xl rounded-lg border border-gray-200 px-4 py-3 dark:border-white/10">
      <summary className="cursor-pointer text-[12px] font-medium text-gray-700 dark:text-gray-300">Edit the text</summary>
      <div className="mt-3 space-y-3">
        <label className="block text-[11px] text-gray-500">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-[13px] text-gray-900 dark:border-white/10 dark:bg-transparent dark:text-gray-100" />
        </label>
        <label className="block text-[11px] text-gray-500">
          Subtitle
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-[13px] text-gray-900 dark:border-white/10 dark:bg-transparent dark:text-gray-100" />
        </label>
        <label className="block text-[11px] text-gray-500">
          Text
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={16} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 font-mono text-[12px] text-gray-900 dark:border-white/10 dark:bg-transparent dark:text-gray-100" />
        </label>
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={pending} className="rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-gray-800 disabled:opacity-50">
            {pending ? "Saving…" : "Save"}
          </button>
          {message && <span className="text-[12px] text-gray-500">{message}</span>}
        </div>
      </div>
    </details>
  );
}

"use client";

import { useState, useTransition } from "react";
import { updateWebsiteUrl } from "./actions";

/** The profile's website with an edit control (#1754: there was no way to correct a bad one). */
export function WebsiteField({ institutionId, websiteUrl }: { institutionId: number; websiteUrl: string | null }) {
  const [current, setCurrent] = useState(websiteUrl);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(websiteUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!value.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await updateWebsiteUrl(institutionId, value.trim());
      if (result.error) {
        setError(result.error);
        return;
      }
      setCurrent(value.trim().replace(/\/$/, ""));
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <span className="block space-y-1">
        <input
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="https://www.example.com"
          aria-label="Website"
          autoFocus
          className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-white/[0.1] rounded bg-white dark:bg-white/[0.05] text-gray-900 dark:text-gray-100"
        />
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={pending || !value.trim()}
            className="px-2 py-1 text-[11px] font-semibold rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 disabled:opacity-50"
          >
            {pending ? "Saving..." : "Save website"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setValue(current ?? "");
              setError(null);
            }}
            className="px-2 py-1 text-[11px] font-semibold rounded bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400"
          >
            Cancel
          </button>
        </span>
        {error && <span className="block text-[11px] text-red-600 dark:text-red-400">{error}</span>}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      {current ? (
        <a href={current} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline break-all">
          {current.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </a>
      ) : (
        <span className="text-gray-400">-</span>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
      >
        Edit
      </button>
    </span>
  );
}

"use client";

import { useState } from "react";
import { addHitListLink } from "./actions";

export function HitListLinkForm({ institutionId }: { institutionId: number }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setResult(null);
    const outcome = await addHitListLink(institutionId, url).catch((error: unknown) => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }));
    setBusy(false);
    setResult(outcome);
    if (outcome.ok) setUrl("");
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-1">
      <div className="flex gap-2">
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Paste the fee schedule link"
          aria-label="Fee schedule link"
          className="min-w-0 flex-1 rounded-md border border-black/15 bg-white px-2 py-1.5 text-sm dark:border-white/15 dark:bg-transparent"
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="rounded-md bg-[#1d1d1b] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-[#1d1d1b]"
        >
          {busy ? "Saving" : "Add"}
        </button>
      </div>
      {result && <p className={`text-xs ${result.ok ? "text-emerald-700" : "text-red-700"}`}>{result.message}</p>}
    </form>
  );
}

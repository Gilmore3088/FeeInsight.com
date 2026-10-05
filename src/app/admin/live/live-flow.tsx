"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FLOW_AGENTS, type FlowMove, type FlowSnapshot, type FlowWaiting, type MoveTone } from "@/lib/agents/flow-model";

const POLL_MS = 10_000;

type Data = FlowSnapshot & { waiting: FlowWaiting | null };

const TONE: Record<MoveTone, { mark: string; label: string; className: string }> = {
  ok: { mark: "✓", label: "Done", className: "text-emerald-700 dark:text-emerald-400" },
  warn: { mark: "!", label: "Needs another try", className: "text-amber-700 dark:text-amber-400" },
  error: { mark: "✕", label: "Failed", className: "text-red-700 dark:text-red-400" },
};

const NOW_STYLE = {
  working: "text-emerald-800 dark:text-emerald-300",
  queued: "text-sky-800 dark:text-sky-300",
  idle: "text-gray-600 dark:text-gray-400",
};

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function number(value: number): string {
  return value.toLocaleString("en-US");
}

function MoveLine({ move, showAgent }: { move: FlowMove; showAgent?: string }) {
  const tone = TONE[move.tone];
  return (
    <li className="flex gap-2 py-1.5 text-sm">
      <span className={`w-4 shrink-0 text-center font-bold ${tone.className}`} aria-label={tone.label} role="img">
        {tone.mark}
      </span>
      <span className="w-16 shrink-0 tabular-nums text-xs leading-5 text-gray-500">{clock(move.at)}</span>
      <span className="min-w-0">
        <Link href={`/admin/institution/${move.institutionId}`} className="font-semibold text-gray-900 underline-offset-2 hover:underline dark:text-gray-100">
          {move.institutionName}
        </Link>
        {move.stateCode ? <span className="text-gray-500"> ({move.stateCode})</span> : null}
        {showAgent ? <span className="text-gray-500"> · {showAgent}</span> : null}
        <span className="text-gray-700 dark:text-gray-300">: {move.text}</span>
      </span>
    </li>
  );
}

export function LiveFlow({ initial }: { initial: Data }) {
  const [data, setData] = useState<Data>(initial);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    async function load() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/admin/flow", { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as Data;
        if (!cancelled) {
          setData(body);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [paused]);

  const nameOf = (agent: string) => FLOW_AGENTS.find((item) => item.agent === agent)?.name ?? agent;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
        <span>
          {paused ? "Paused." : "Updates every 10 seconds."} Last update {clock(data.generatedAt)}.
          {failed ? " The last update failed; showing the previous one." : ""}
        </span>
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          className="rounded border border-black/15 px-2.5 py-1 text-xs font-semibold text-gray-800 hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)] dark:border-white/20 dark:text-gray-200"
        >
          {paused ? "Resume updates" : "Pause updates"}
        </button>
      </div>

      <ol aria-label="The agents, in the order each bank passes through them" className="space-y-3">
        {FLOW_AGENTS.map((meta, index) => {
          const now = data.now.find((item) => item.agent === meta.agent);
          const waiting = meta.agent === "atlas" ? null : data.waiting?.[meta.agent];
          const recent = data.moves.filter((move) => move.agent === meta.agent).slice(0, 5);
          return (
            <li key={meta.agent} className="rounded-lg border border-black/[0.08] px-4 py-3 dark:border-white/[0.1]">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  <span className="text-gray-400">{index + 1}. </span>
                  <Link href={meta.href} className="hover:underline">{meta.name}</Link>
                  <span className="ml-2 text-sm font-normal text-gray-500">{meta.job}</span>
                </h2>
                <p className="text-sm">
                  <span className={`font-semibold ${NOW_STYLE[now?.state ?? "idle"]}`}>{now?.text ?? "Nothing to do this minute"}</span>
                  {waiting !== null && waiting !== undefined ? (
                    <span className="text-gray-600 dark:text-gray-400"> · {number(waiting)} banks waiting</span>
                  ) : null}
                </p>
              </div>
              {meta.agent === "atlas" ? null : recent.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">No banks handled in the last day.</p>
              ) : (
                <ul aria-label={`Banks ${meta.name} just handled`} className="mt-1">
                  {recent.map((move) => <MoveLine key={move.key} move={move} />)}
                </ul>
              )}
            </li>
          );
        })}
        {data.waiting ? (
          <li className="rounded-lg border border-emerald-600/30 bg-emerald-50/50 px-4 py-3 text-sm dark:bg-emerald-950/20">
            <span className="font-semibold text-gray-900 dark:text-gray-100">Live on the site: </span>
            <span className="text-gray-700 dark:text-gray-300">
              {number(data.waiting.published)} of {number(data.waiting.total)} banks have published fees.
            </span>
            <span className="text-gray-500"> Waiting counts refresh every 5 minutes.</span>
          </li>
        ) : null}
      </ol>

      <section aria-label="Every recent move">
        <h2 className="admin-section-title">Every recent move, newest first</h2>
        {data.moves.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No banks handled in the last day.</p>
        ) : (
          <ul className="mt-1 divide-y divide-black/[0.05] dark:divide-white/[0.06]">
            {data.moves.slice(0, 60).map((move) => <MoveLine key={move.key} move={move} showAgent={nameOf(move.agent)} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

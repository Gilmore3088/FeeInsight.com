"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { FLOW_AGENTS, isWentLive, latestPerInstitution, type FlowMove, type FlowNow, type FlowSnapshot, type FlowWaiting, type MoveTone } from "@/lib/agents/flow-model";
import type { AdminAgent } from "@/lib/agents/types";

const POLL_MS = 10_000;

type Data = FlowSnapshot & { waiting: FlowWaiting | null };
type Worker = Exclude<AdminAgent, "atlas">;

const WORKERS: Worker[] = ["magellan", "rosetta", "knox", "darwin", "hamilton"];

/** One colour per agent, used for its badge, top bar, and dots in the log. */
const AGENT_COLOR: Record<AdminAgent, { bar: string; badge: string; dot: string; flash: string }> = {
  atlas: { bar: "bg-slate-500", badge: "bg-slate-600 text-white", dot: "bg-slate-500", flash: "rgb(100 116 139 / 0.15)" },
  magellan: { bar: "bg-sky-500", badge: "bg-sky-600 text-white", dot: "bg-sky-500", flash: "rgb(14 165 233 / 0.15)" },
  rosetta: { bar: "bg-violet-500", badge: "bg-violet-600 text-white", dot: "bg-violet-500", flash: "rgb(139 92 246 / 0.15)" },
  knox: { bar: "bg-amber-500", badge: "bg-amber-600 text-white", dot: "bg-amber-500", flash: "rgb(245 158 11 / 0.18)" },
  darwin: { bar: "bg-teal-500", badge: "bg-teal-600 text-white", dot: "bg-teal-500", flash: "rgb(20 184 166 / 0.15)" },
  hamilton: { bar: "bg-[var(--brand-primary)]", badge: "bg-[var(--brand-primary)] text-white", dot: "bg-[var(--brand-primary)]", flash: "rgb(194 65 12 / 0.12)" },
};

const TONE: Record<MoveTone, { mark: string; label: string; text: string; ring: string }> = {
  ok: { mark: "✓", label: "Done", text: "text-emerald-700 dark:text-emerald-400", ring: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300" },
  warn: { mark: "!", label: "Held or sent back", text: "text-amber-700 dark:text-amber-400", ring: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300" },
  error: { mark: "✕", label: "Failed", text: "text-red-700 dark:text-red-400", ring: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300" },
};

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function number(value: number): string {
  return value.toLocaleString("en-US");
}

function meta(agent: AdminAgent) {
  return FLOW_AGENTS.find((item) => item.agent === agent)!;
}

function StatusPill({ now }: { now: FlowNow | undefined }) {
  const state = now?.state ?? "idle";
  if (state === "working") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
        <span className="relative flex h-2 w-2">
          <span className="live-pulse absolute inline-flex h-full w-full rounded-full bg-emerald-500" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        {now!.text}
      </span>
    );
  }
  if (state === "queued") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800 dark:bg-sky-900/50 dark:text-sky-300">
        <span className="h-2 w-2 rounded-full bg-sky-500" />
        {now!.text}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-400">
      <span className="h-2 w-2 rounded-full bg-gray-400" />
      Idle
    </span>
  );
}

/** The line between two stations; a dot rides it into the next agent while that agent works. */
function Connector({ active, color }: { active: boolean; color: string }) {
  return (
    <div aria-hidden className="flex items-center justify-center py-1 xl:w-6 xl:shrink-0 xl:py-0">
      <div className="relative h-6 w-px bg-gray-300 xl:hidden dark:bg-white/20">
        {active ? <span className={`flow-dot-down absolute -left-[3px] h-[7px] w-[7px] rounded-full ${color}`} /> : null}
      </div>
      <div className="relative hidden h-px w-full bg-gray-300 xl:block dark:bg-white/20">
        {active ? <span className={`flow-dot absolute -top-[3px] h-[7px] w-[7px] rounded-full ${color}`} /> : null}
        <span className="absolute -right-0.5 -top-[4px] text-[9px] leading-none text-gray-400">▶</span>
      </div>
    </div>
  );
}

function BankCard({ move, isNew, agent }: { move: FlowMove; isNew: boolean; agent: AdminAgent }) {
  const tone = TONE[move.tone];
  return (
    <li
      className={`rounded-md border border-black/[0.06] bg-white px-2 py-1.5 dark:border-white/[0.08] dark:bg-white/[0.03] ${isNew ? "flow-card-new" : ""}`}
      style={isNew ? ({ "--flow-flash": AGENT_COLOR[agent].flash } as React.CSSProperties) : undefined}
    >
      <div className="flex items-start gap-1.5">
        <span
          role="img"
          aria-label={tone.label}
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${tone.ring}`}
        >
          {tone.mark}
        </span>
        <div className="min-w-0">
          <Link
            href={`/admin/institution/${move.institutionId}`}
            title={move.institutionName}
            className="line-clamp-2 text-[13px] font-semibold leading-5 text-gray-900 hover:underline dark:text-gray-100"
          >
            {move.institutionName}
          </Link>
          <p className={`text-xs leading-4 ${tone.text}`}>{move.text}</p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            {move.stateCode ?? "All states"} · {clock(move.at)}
          </p>
        </div>
      </div>
    </li>
  );
}

function Station({
  agent,
  step,
  now,
  waiting,
  moves,
  fresh,
}: {
  agent: Worker;
  step: number;
  now: FlowNow | undefined;
  waiting: number | undefined;
  moves: FlowMove[];
  fresh: Set<string>;
}) {
  const info = meta(agent);
  const color = AGENT_COLOR[agent];
  return (
    <section
      aria-label={`${info.name}: ${info.job}`}
      className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-black/[0.08] bg-gray-50/60 dark:border-white/[0.1] dark:bg-white/[0.02]"
    >
      <div className={`h-1 ${color.bar}`} />
      <div className="space-y-2 px-3 pb-3 pt-2.5">
        <div className="flex items-center gap-2">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${color.badge}`}>{step}</span>
          <Link href={info.href} className="text-[15px] font-semibold text-gray-900 hover:underline dark:text-gray-100">
            {info.name}
          </Link>
        </div>
        <p className="min-h-8 text-xs leading-4 text-gray-600 dark:text-gray-400">{info.job}</p>
        <StatusPill now={now} />
        <div>
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-gray-900 dark:text-gray-100">
            {waiting === undefined ? "–" : number(waiting)}
          </p>
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">banks in line</p>
        </div>
      </div>
      <div className="flex-1 border-t border-black/[0.06] px-2 pb-2 pt-2 dark:border-white/[0.08]">
        <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">Just handled</p>
        {moves.length === 0 ? (
          <p className="px-1 text-xs text-gray-500">No banks in the last day.</p>
        ) : (
          <ul className="space-y-1.5" aria-label={`Banks ${info.name} just handled`}>
            {moves.map((move) => (
              <BankCard key={move.key} move={move} agent={agent} isNew={fresh.has(move.key)} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function OnTheSite({ waiting, live, fresh }: { waiting: FlowWaiting | null; live: FlowMove[]; fresh: Set<string> }) {
  const share = waiting && waiting.total > 0 ? (waiting.published / waiting.total) * 100 : 0;
  return (
    <section
      aria-label="Live on the site"
      className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-emerald-600/30 bg-emerald-50/70 xl:max-w-[11rem] dark:bg-emerald-950/30"
    >
      <div className="h-1 bg-emerald-500" />
      <div className="space-y-2 px-3 pb-3 pt-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">✓</span>
          <span className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">On the site</span>
        </div>
        <p className="min-h-8 text-xs leading-4 text-gray-600 dark:text-gray-400">Banks with fees anyone can look up</p>
        <p className="text-3xl font-semibold tabular-nums tracking-tight text-emerald-800 dark:text-emerald-300">
          {waiting ? number(waiting.published) : "–"}
        </p>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          of {waiting ? number(waiting.total) : "–"} banks ({share.toFixed(0)}%)
        </p>
        <div
          role="progressbar"
          aria-label="Share of banks live on the site"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share)}
          className="h-2 overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-900/40"
        >
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${share}%` }} />
        </div>
      </div>
      <div className="flex-1 border-t border-emerald-600/20 px-2 pb-2 pt-2">
        <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">Just went live</p>
        {live.length === 0 ? (
          <p className="px-1 text-xs text-gray-500">Nothing new in the last day.</p>
        ) : (
          <ul className="space-y-1.5" aria-label="Banks that just went live">
            {live.map((move) => (
              <BankCard key={move.key} move={move} agent="hamilton" isNew={fresh.has(move.key)} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function LiveFlow({ initial }: { initial: Data }) {
  const [data, setData] = useState<Data>(initial);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef(new Set(initial.moves.map((move) => move.key)));

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    async function load() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/admin/flow", { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as Data;
        if (cancelled) return;
        const arrived = new Set(body.moves.filter((move) => !seen.current.has(move.key)).map((move) => move.key));
        for (const key of arrived) seen.current.add(key);
        setFresh(arrived);
        setData(body);
        setFailed(false);
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

  const nowOf = (agent: AdminAgent) => data.now.find((item) => item.agent === agent);
  const atlas = nowOf("atlas");
  const working = WORKERS.filter((agent) => nowOf(agent)?.state === "working").map((agent) => meta(agent).name);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 rounded-xl border border-black/[0.08] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-white/[0.1] dark:bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${AGENT_COLOR.atlas.badge}`}>A</span>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100" aria-live="polite">
              {atlas?.state === "working" ? `Atlas is ${atlas.text.charAt(0).toLowerCase()}${atlas.text.slice(1)}` : "Atlas has no passes running"}
              {working.length > 0 ? ` · ${working.join(", ")} working now` : ""}
            </p>
            <p className="text-xs text-gray-500">
              {paused ? "Paused" : "Updates every 10 seconds"} · last update {clock(data.generatedAt)}
              {failed ? " · last update failed, showing the previous one" : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          className="self-start rounded-md border border-black/15 px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)] sm:self-auto dark:border-white/20 dark:text-gray-200"
        >
          {paused ? "Resume updates" : "Pause updates"}
        </button>
      </div>

      <div className="flex flex-col xl:flex-row xl:items-stretch">
        {WORKERS.map((agent, index) => (
          <Fragment key={agent}>
            <Station
              agent={agent}
              step={index + 1}
              now={nowOf(agent)}
              waiting={data.waiting?.[agent]}
              moves={latestPerInstitution(data.moves, (move) => move.agent === agent, 4)}
              fresh={fresh}
            />
            <Connector
              active={index + 1 < WORKERS.length ? nowOf(WORKERS[index + 1])?.state === "working" : false}
              color={AGENT_COLOR[WORKERS[index + 1] ?? "hamilton"].dot}
            />
          </Fragment>
        ))}
        <OnTheSite
          waiting={data.waiting}
          live={latestPerInstitution(data.moves, isWentLive, 4).map((move) => {
            const live = data.liveFees?.[move.institutionId];
            return live ? { ...move, text: `Now has ${number(live)} fee${live === 1 ? "" : "s"} live` } : move;
          })}
          fresh={fresh}
        />
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
        {(Object.keys(TONE) as MoveTone[]).map((tone) => (
          <span key={tone} className="inline-flex items-center gap-1.5">
            <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${TONE[tone].ring}`}>{TONE[tone].mark}</span>
            {TONE[tone].label}
          </span>
        ))}
        <span>&ldquo;Banks in line&rdquo; refreshes every 5 minutes.</span>
      </div>

      <section aria-label="Every recent move">
        <h2 className="admin-section-title">Every recent move, newest first</h2>
        {data.moves.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No banks handled in the last day.</p>
        ) : (
          <ol className="mt-3 border-l-2 border-black/[0.06] dark:border-white/[0.08]">
            {data.moves.slice(0, 50).map((move) => {
              const tone = TONE[move.tone];
              return (
                <li key={move.key} className={`relative py-1.5 pl-5 text-sm ${fresh.has(move.key) ? "flow-card-new" : ""}`}>
                  <span className={`absolute -left-[5px] top-3 h-2 w-2 rounded-full ${AGENT_COLOR[move.agent].dot}`} aria-hidden />
                  <span className="tabular-nums text-xs text-gray-500">{clock(move.at)}</span>
                  <span className="ml-2 text-xs font-semibold text-gray-700 dark:text-gray-300">{meta(move.agent).name}</span>
                  <span className="ml-2">
                    <Link href={`/admin/institution/${move.institutionId}`} className="font-semibold text-gray-900 hover:underline dark:text-gray-100">
                      {move.institutionName}
                    </Link>
                    {move.stateCode ? <span className="text-gray-500"> ({move.stateCode})</span> : null}
                    <span className={tone.text}>: {move.text}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

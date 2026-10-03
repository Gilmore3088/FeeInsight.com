"use client";

import type { FeeReport, AgentId, MappedFee } from "@/lib/scout/types";
import type { AuditAgentId, AuditResult, BatchSummary } from "@/lib/scout/audit-types";

// -- Constants ----------------------------------------------------------------

export const AGENT_IDS: AgentId[] = ["scout", "classifier", "extractor", "analyst"];

export const STEPS: { id: AgentId; n: string; label: string; desc: string }[] = [
  { id: "scout",      n: "01", label: "Database Lookup",    desc: "Searches Bank Fee Index for this institution" },
  { id: "classifier", n: "02", label: "Data Quality Check", desc: "Assesses completeness and freshness" },
  { id: "extractor",  n: "03", label: "Fee Structuring",    desc: "Maps database records to report schema" },
  { id: "analyst",    n: "04", label: "Report Synthesis",   desc: "AI analyst generates intelligence report" },
];

export const AUDIT_AGENT_IDS: AuditAgentId[] = ["validator", "discoverer", "ai_scout", "reporter"];

export const AUDIT_STEPS: { id: AuditAgentId; n: string; label: string; desc: string }[] = [
  { id: "validator",  n: "01", label: "URL Validation",       desc: "Checks if existing URL is a real fee schedule" },
  { id: "discoverer", n: "02", label: "Heuristic Discovery",  desc: "Runs 6-method cascade to find fee schedule URL" },
  { id: "ai_scout",   n: "03", label: "AI Scout",             desc: "AI scorer evaluates homepage links for fee schedules" },
  { id: "reporter",   n: "04", label: "Reporter",             desc: "Summarizes audit results and changes" },
];

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR",
] as const;

export const CATS: Record<string, { label: string; tw: string; bgTw: string; borderTw: string }> = {
  account_maintenance: { label: "Account Maintenance", tw: "text-blue-700",    bgTw: "bg-blue-50",    borderTw: "border-blue-200" },
  overdraft_nsf:       { label: "Overdraft / NSF",     tw: "text-red-700",     bgTw: "bg-red-50",     borderTw: "border-red-200" },
  atm:                 { label: "ATM",                 tw: "text-emerald-700", bgTw: "bg-emerald-50", borderTw: "border-emerald-200" },
  wire:                { label: "Wire Transfer",       tw: "text-amber-700",   bgTw: "bg-amber-50",   borderTw: "border-amber-200" },
  card:                { label: "Card Services",       tw: "text-purple-700",  bgTw: "bg-purple-50",  borderTw: "border-purple-200" },
  foreign:             { label: "Foreign / FX",        tw: "text-teal-700",    bgTw: "bg-teal-50",    borderTw: "border-teal-200" },
  other:               { label: "Other",               tw: "text-gray-500",    bgTw: "bg-gray-50",    borderTw: "border-gray-200" },
};

// -- Type definitions ---------------------------------------------------------

export type AgentStatus = "idle" | "running" | "ok" | "warn" | "error";

export interface LogMsg {
  id: number;
  text: string;
}

export interface AgentState {
  status: AgentStatus;
  data: Record<string, unknown> | null;
  ms: number | null;
  msgs: LogMsg[];
}

export interface StepDef {
  id: string;
  n: string;
  label: string;
  desc: string;
}

export interface AutocompleteItem {
  id: number;
  institution_name: string;
  state: string | null;
  charter_type: string | null;
}

// -- Research state machine ---------------------------------------------------

export interface PipelineState {
  status: "idle" | "running" | "done" | "error";
  agents: Record<AgentId, AgentState>;
  report: FeeReport | null;
  error: string | null;
}

export type Action =
  | { type: "RESET" }
  | { type: "STATUS"; val: PipelineState["status"] }
  | { type: "AGENT_START"; id: AgentId }
  | { type: "AGENT_DONE"; id: AgentId; ok: boolean; data: Record<string, unknown> | null; ms: number }
  | { type: "LOG"; agentId: AgentId; msg: string }
  | { type: "PIPELINE_ERROR"; msg: string }
  | { type: "REPORT"; report: FeeReport };

function mkAgent(): AgentState {
  return { status: "idle", data: null, ms: null, msgs: [] };
}

export function mkState(): PipelineState {
  return {
    status: "idle",
    agents: Object.fromEntries(AGENT_IDS.map((id) => [id, mkAgent()])) as Record<AgentId, AgentState>,
    report: null,
    error: null,
  };
}

export function reducer(state: PipelineState, action: Action): PipelineState {
  switch (action.type) {
    case "RESET":
      return mkState();
    case "STATUS":
      return { ...state, status: action.val };
    case "AGENT_START":
      return {
        ...state,
        agents: { ...state.agents, [action.id]: { ...mkAgent(), status: "running" } },
      };
    case "AGENT_DONE":
      return {
        ...state,
        agents: {
          ...state.agents,
          [action.id]: {
            ...state.agents[action.id],
            status: action.ok ? "ok" : "warn",
            data: action.data,
            ms: action.ms,
          },
        },
      };
    case "LOG": {
      const a = state.agents[action.agentId];
      return {
        ...state,
        agents: {
          ...state.agents,
          [action.agentId]: {
            ...a,
            msgs: [...a.msgs, { id: Date.now() + Math.random(), text: action.msg }],
          },
        },
      };
    }
    case "PIPELINE_ERROR": {
      const agents = { ...state.agents };
      AGENT_IDS.forEach((id) => {
        if (agents[id].status === "running") {
          agents[id] = { ...agents[id], status: "error" };
        }
      });
      return { ...state, agents, error: action.msg };
    }
    case "REPORT":
      return { ...state, report: action.report };
    default:
      return state;
  }
}

// -- Audit state machine ------------------------------------------------------

export interface AuditAgentState {
  status: AgentStatus;
  data: Record<string, unknown> | null;
  ms: number | null;
  msgs: LogMsg[];
}

export interface AuditPipelineState {
  status: "idle" | "running" | "done" | "error";
  agents: Record<AuditAgentId, AuditAgentState>;
  result: AuditResult | null;
  error: string | null;
}

export type AuditAction =
  | { type: "RESET" }
  | { type: "STATUS"; val: AuditPipelineState["status"] }
  | { type: "AGENT_START"; id: AuditAgentId }
  | { type: "AGENT_DONE"; id: AuditAgentId; ok: boolean; data: Record<string, unknown> | null; ms: number }
  | { type: "LOG"; agentId: AuditAgentId; msg: string }
  | { type: "PIPELINE_ERROR"; msg: string }
  | { type: "RESULT"; result: AuditResult };

function mkAuditAgent(): AuditAgentState {
  return { status: "idle", data: null, ms: null, msgs: [] };
}

export function mkAuditState(): AuditPipelineState {
  return {
    status: "idle",
    agents: Object.fromEntries(AUDIT_AGENT_IDS.map((id) => [id, mkAuditAgent()])) as Record<AuditAgentId, AuditAgentState>,
    result: null,
    error: null,
  };
}

export function auditReducer(state: AuditPipelineState, action: AuditAction): AuditPipelineState {
  switch (action.type) {
    case "RESET":
      return mkAuditState();
    case "STATUS":
      return { ...state, status: action.val };
    case "AGENT_START":
      return {
        ...state,
        agents: { ...state.agents, [action.id]: { ...mkAuditAgent(), status: "running" } },
      };
    case "AGENT_DONE":
      return {
        ...state,
        agents: {
          ...state.agents,
          [action.id]: {
            ...state.agents[action.id],
            status: action.ok ? "ok" : "warn",
            data: action.data,
            ms: action.ms,
          },
        },
      };
    case "LOG": {
      const a = state.agents[action.agentId];
      return {
        ...state,
        agents: {
          ...state.agents,
          [action.agentId]: {
            ...a,
            msgs: [...a.msgs, { id: Date.now() + Math.random(), text: action.msg }],
          },
        },
      };
    }
    case "PIPELINE_ERROR": {
      const agents = { ...state.agents };
      AUDIT_AGENT_IDS.forEach((id) => {
        if (agents[id].status === "running") {
          agents[id] = { ...agents[id], status: "error" };
        }
      });
      return { ...state, agents, error: action.msg };
    }
    case "RESULT":
      return { ...state, result: action.result };
    default:
      return state;
  }
}

// -- Small UI components ------------------------------------------------------

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <div
      className="shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        border: "2px solid var(--scout-spinner-track)",
        borderTop: "2px solid var(--scout-accent)",
        animation: "spin .8s linear infinite",
      }}
    />
  );
}

function Dot({ d }: { d: number }) {
  return (
    <span
      className="inline-block w-1 h-1 rounded-full bg-red-700"
      style={{ animation: `blink 1.2s ${d * 0.25}s ease-in-out infinite` }}
    />
  );
}

function Tag({
  label,
  twText = "text-gray-500",
  twBg = "bg-gray-50",
  twBorder = "border-gray-200",
}: {
  label: string;
  twText?: string;
  twBg?: string;
  twBorder?: string;
}) {
  return (
    <span
      className={`font-mono text-[10px] tracking-wider uppercase px-2 py-0.5 rounded-sm border ${twText} ${twBg} ${twBorder}`}
    >
      {label}
    </span>
  );
}

// -- Agent Card ---------------------------------------------------------------

interface AgentCardProps {
  step: StepDef;
  agent: AgentState;
  expanded: boolean;
  onToggle: () => void;
  hideDetail?: boolean;
}

export function AgentCard({ step, agent, expanded, onToggle, hideDetail }: AgentCardProps) {
  const { status, data, ms, msgs } = agent;
  const isIdle = status === "idle";
  const isRunning = status === "running";
  const isOk = status === "ok";
  const isWarn = status === "warn";
  const isErr = status === "error";
  const isDone = isOk || isWarn;

  const accentBorderClass = isRunning
    ? "border-l-red-700"
    : isOk
      ? "border-l-emerald-700"
      : isWarn
        ? "border-l-amber-700"
        : isErr
          ? "border-l-red-700"
          : "border-l-gray-200";
  const cardBgClass = isRunning
    ? "bg-red-50/60"
    : isOk
      ? "bg-emerald-50/60"
      : isWarn
        ? "bg-amber-50/60"
        : "bg-white";

  const summary =
    isDone && data
      ? (() => {
          const d = data as Record<string, unknown>;
          if (step.id === "scout") {
            const targets = d.targets as unknown[] | undefined;
            const fees = d.fees as unknown[] | undefined;
            return `${targets?.length || 0} match${(targets?.length ?? 0) !== 1 ? "es" : ""} · ${fees?.length || 0} fees`;
          }
          if (step.id === "classifier")
            return `${d.availability} availability · ${d.feeCount} records`;
          if (step.id === "extractor") {
            const fees = d.fees as unknown[] | undefined;
            return `${fees?.length || 0} fees structured · ${Math.round(((d.confidence as number) || 0) * 100)}% conf.`;
          }
          if (step.id === "analyst") {
            const cs = d.consumer_score as { score?: number } | undefined;
            return `Score ${cs?.score}/10 · ${d.data_quality}`;
          }
          return null;
        })()
      : null;

  return (
    <div
      className={`${cardBgClass} border border-gray-200 border-l-4 ${accentBorderClass} rounded-md overflow-hidden mb-2 transition-all duration-200`}
      style={{ opacity: isIdle ? 0.4 : 1 }}
    >
      {/* Header */}
      <div
        className={`flex items-center gap-3 px-4 py-3 ${isDone ? "cursor-pointer" : ""}`}
        onClick={() => isDone && onToggle()}
      >
        <span className="font-mono text-[10px] text-gray-400 min-w-5 shrink-0">{step.n}</span>
        {isRunning && <Spinner />}
        {isOk && <span className="text-emerald-700 text-[15px] shrink-0">&#10003;</span>}
        {isWarn && <span className="text-amber-700 text-[15px] shrink-0">&#9888;</span>}
        {isErr && <span className="text-red-700 text-[15px] shrink-0">&#10007;</span>}
        {isIdle && <span className="text-gray-400 text-[13px] shrink-0">&#9675;</span>}
        <div className="flex-1">
          <div className="font-sans font-semibold text-[13px] text-gray-900">{step.label}</div>
          {isIdle && <div className="font-sans text-[11px] text-gray-400 mt-px">{step.desc}</div>}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {ms != null && (
            <span className="font-mono text-[10px] text-gray-400">{(ms / 1000).toFixed(1)}s</span>
          )}
          {summary && <span className="font-sans text-[11px] text-emerald-700">{summary}</span>}
          {isErr && <span className="font-sans text-[11px] text-red-700">Failed</span>}
          {isDone && <span className="text-gray-500 text-[11px]">{expanded ? "\u25B2" : "\u25BC"}</span>}
        </div>
      </div>

      {/* Live message feed */}
      {msgs.length > 0 && (isRunning || (!expanded && isDone)) && (
        <div className="border-t border-gray-200 py-2 px-4 pl-[52px]">
          {msgs.map((m, i) => {
            const isLast = i === msgs.length - 1;
            const isActive = isLast && isRunning;
            return (
              <div
                key={m.id}
                className="flex items-center gap-2 py-0.5"
                style={{ animation: "fadein .15s ease" }}
              >
                <span
                  className={`font-mono text-[10px] shrink-0 ${isActive ? "text-red-700" : "text-gray-400"}`}
                >
                  {isActive ? "\u25B6" : "\u00B7"}
                </span>
                <span
                  className={`font-sans text-xs flex-1 leading-relaxed ${isActive ? "text-gray-900" : "text-gray-500"}`}
                >
                  {m.text}
                </span>
                {isActive && (
                  <span className="flex gap-0.5 shrink-0">
                    <Dot d={0} />
                    <Dot d={1} />
                    <Dot d={2} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Expanded detail */}
      {expanded && isDone && (
        <div
          className="border-t border-gray-200 bg-gray-50 p-4"
          style={{ animation: "fadein .2s ease" }}
        >
          {/* Activity log */}
          {msgs.length > 0 && (
            <div className={data && !hideDetail ? "mb-4 pb-3.5 border-b border-gray-100" : ""}>
              <div className="font-sans text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Activity Log
              </div>
              {msgs.map((m) => (
                <div key={m.id} className="flex gap-2 py-0.5 font-sans text-[11px] text-gray-500">
                  <span className="text-emerald-700 shrink-0">&#10003;</span>
                  <span>{m.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Agent-specific detail (research mode only) */}
          {data && !hideDetail && <AgentDetail step={step} data={data} />}
        </div>
      )}
    </div>
  );
}

// -- Agent detail panels ------------------------------------------------------

function AgentDetail({ step, data }: { step: StepDef; data: Record<string, unknown> }) {
  if (step.id === "scout") return <ScoutDetail data={data} />;
  if (step.id === "classifier") return <ClassifierDetail data={data} />;
  if (step.id === "extractor") return <ExtractorDetail data={data} />;
  if (step.id === "analyst") return <AnalystDetail data={data} />;
  return null;
}

function MetaGrid({ items }: { items: [string, string | undefined][] }) {
  return (
    <div className="flex gap-5 flex-wrap mb-3.5">
      {items
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k}>
            <div className="font-sans text-[10px] text-gray-500 uppercase tracking-wider mb-1">{k}</div>
            <div className="font-sans text-[13px] font-medium text-gray-900 capitalize">{v}</div>
          </div>
        ))}
    </div>
  );
}

function ScoutDetail({ data }: { data: Record<string, unknown> }) {
  const inst = data.institution as Record<string, unknown> | undefined;
  const targets = data.targets as Record<string, unknown>[] | undefined;
  const primaryDocUrl = data.primaryDocUrl as string | undefined;

  return (
    <div>
      <div className="font-sans text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2.5">
        Matched Institution
      </div>
      <MetaGrid
        items={[
          ["Name", inst?.institution_name as string],
          ["DB ID", String(inst?.id)],
          ["State", inst?.state as string],
          ["Charter", inst?.charter_type as string],
          ["Fees", String((data.fees as unknown[])?.length || 0)],
          ["Source reads", String((data.crawlResults as unknown[])?.length || 0)],
        ]}
      />
      {(targets?.length ?? 0) > 1 && (
        <div className="p-2.5 px-3 bg-amber-50 border border-amber-200 rounded-md">
          <div className="font-sans text-[11px] text-amber-700 font-semibold mb-1.5">Other matches</div>
          {targets!.slice(1).map((t) => (
            <div key={t.id as number} className="font-sans text-xs text-gray-900 mb-0.5">
              &bull; {t.institution_name as string} (ID: {t.id as number})
            </div>
          ))}
        </div>
      )}
      {primaryDocUrl && (
        <div className="mt-3">
          <div className="font-sans text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
            Source Document
          </div>
          <a
            href={primaryDocUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] text-red-700 break-all hover:underline"
          >
            {primaryDocUrl}
          </a>
        </div>
      )}
    </div>
  );
}

function ClassifierDetail({ data }: { data: Record<string, unknown> }) {
  const categories = data.categories as string[] | undefined;
  return (
    <div>
      <MetaGrid
        items={[
          ["Availability", data.availability as string],
          ["Fee Records", String(data.feeCount)],
          ["With Amounts", String(data.hasAmounts)],
          ["Categories", String(categories?.length)],
          ["Crawl Status", data.latestCrawlStatus as string],
        ]}
      />
      {(categories?.length ?? 0) > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {categories!.map((c) => (
            <Tag key={c} label={c.replace(/_/g, " ")} twText="text-red-700" twBg="bg-red-50" twBorder="border-red-200" />
          ))}
        </div>
      )}
    </div>
  );
}

function ExtractorDetail({ data }: { data: Record<string, unknown> }) {
  const fees = data.fees as { name: string; amount: string }[] | undefined;
  return (
    <div>
      <MetaGrid
        items={[
          ["Records", String(fees?.length || 0)],
          ["Confidence", `${Math.round(((data.confidence as number) || 0) * 100)}%`],
          ["Source", data.source_type as string],
          ["As Of", data.knowledge_date as string],
        ]}
      />
      {(fees?.length ?? 0) > 0 && (
        <>
          <div className="font-sans text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Fee Preview (first 8)
          </div>
          {fees!.slice(0, 8).map((f, i) => (
            <div
              key={i}
              className={`flex justify-between items-center px-2.5 py-1.5 rounded-sm text-xs ${i % 2 ? "bg-white" : "bg-gray-50"}`}
            >
              <span className="font-sans text-gray-900">{f.name}</span>
              <span className="font-mono text-red-700 font-medium ml-3">{f.amount}</span>
            </div>
          ))}
          {fees!.length > 8 && (
            <div className="font-sans text-[11px] text-gray-500 mt-1.5">
              +{fees!.length - 8} more in the full report below
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AnalystDetail({ data }: { data: Record<string, unknown> }) {
  const cs = data.consumer_score as { score?: number; label?: string } | undefined;
  return (
    <div className="flex gap-6 flex-wrap">
      {(
        [
          ["Quality", data.data_quality as string],
          ["Score", `${cs?.score}/10`],
          ["Rating", cs?.label],
        ] as [string, string | undefined][]
      )
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k}>
            <div className="font-sans text-[10px] text-gray-500 uppercase tracking-wider mb-1">{k}</div>
            <div className="font-sans text-[13px] font-medium text-gray-900 capitalize">{v}</div>
          </div>
        ))}
    </div>
  );
}

// -- Score Ring ----------------------------------------------------------------

export function ScoreRing({ score = 5 }: { score?: number }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const ringColor = score >= 7 ? "var(--scout-ok)" : score >= 4 ? "var(--scout-warn)" : "var(--scout-accent)";
  const ringTextClass = score >= 7 ? "text-emerald-700" : score >= 4 ? "text-amber-700" : "text-red-700";
  const label = score >= 7 ? "Fee-Competitive" : score >= 4 ? "Market Average" : "Above Market";

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-16 h-16 shrink-0">
        <svg aria-hidden="true" width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={r} fill="none" stroke="var(--scout-ring-track)" strokeWidth="5" />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke={ringColor}
            strokeWidth="5"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - score / 10)}
            strokeLinecap="round"
            transform="rotate(-90 32 32)"
            style={{ transition: "stroke-dashoffset 1s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono font-medium text-lg text-gray-900">{score}</span>
        </div>
      </div>
      <div>
        <div className={`font-sans font-semibold text-[15px] ${ringTextClass}`}>
          {label}
        </div>
        <div className="font-sans text-[11px] text-gray-500 mt-0.5">out of 10 -- consumer friendliness</div>
      </div>
    </div>
  );
}

// -- Fee Table ----------------------------------------------------------------

export function FeeTable({ categories }: { categories: Record<string, MappedFee[]> | undefined }) {
  const rows = Object.entries(categories || {}).flatMap(([cat, fees]) =>
    (fees || []).map((f) => ({ ...f, _cat: cat })),
  );

  if (!rows.length) {
    return <div className="p-5 font-sans text-[13px] text-gray-500">No fee records in this category.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-gray-50/80">
            {["Category", "Fee Name", "Amount", "Waivable", "Conditions"].map((h) => (
              <th
                key={h}
                className="text-left px-4 py-2.5 font-sans text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200 whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((f, i) => {
            const cm = CATS[f._cat] || CATS.other;
            return (
              <tr key={i} className={`border-b border-gray-100 ${i % 2 ? "bg-gray-50" : "bg-white"}`}>
                <td className="px-4 py-2.5">
                  <span
                    className={`font-mono text-[10px] px-2 py-0.5 rounded-sm whitespace-nowrap border ${cm.tw} ${cm.bgTw} ${cm.borderTw}`}
                  >
                    {cm.label}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-sans font-medium text-gray-900">{f.name || "\u2014"}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-red-700 font-medium whitespace-nowrap">
                  {f.amount || "\u2014"}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span
                    className={`font-sans text-xs ${f.waivable ? "font-semibold text-emerald-700" : "text-gray-400"}`}
                  >
                    {f.waivable ? "Yes" : "No"}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-sans text-xs text-gray-500">{f.conditions || "\u2014"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// -- Full Report --------------------------------------------------------------

export function Report({ report }: { report: FeeReport }) {
  const qualityClasses: Record<string, { text: string; bg: string; border: string }> = {
    excellent: { text: "text-emerald-700", bg: "bg-emerald-50",  border: "border-emerald-200" },
    good:      { text: "text-blue-700",    bg: "bg-blue-50",     border: "border-blue-200" },
    partial:   { text: "text-amber-700",   bg: "bg-amber-50",    border: "border-amber-200" },
    limited:   { text: "text-red-700",     bg: "bg-red-50",      border: "border-red-200" },
  };
  const qc = qualityClasses[report.data_quality] || { text: "text-gray-500", bg: "bg-gray-50", border: "border-gray-200" };

  return (
    <div style={{ animation: "fadein .5s ease" }}>
      {/* Report header */}
      <div className="bg-white border border-gray-200 rounded-lg px-6 py-5 mb-3">
        <div className="font-sans text-[10px] text-gray-500 uppercase tracking-widest mb-2.5">
          Fee Intelligence Report -- Fee Insight
        </div>
        <div className="flex justify-between items-start gap-4 flex-wrap">
          <div>
            <h2 className="font-serif text-2xl text-gray-900 tracking-tight mb-2.5">{report.institution}</h2>
            <div className="flex gap-2 flex-wrap items-center">
              <Tag label={report.source_summary?.type || "database"} twText="text-red-700" twBg="bg-red-50" twBorder="border-red-200" />
              <Tag label="verified" twText="text-emerald-700" twBg="bg-emerald-50" twBorder="border-emerald-200" />
              {report.source_summary?.as_of && (
                <span className="font-sans text-[11px] text-gray-500">
                  data as of {report.source_summary.as_of}
                </span>
              )}
              {report.source_summary?.url && (
                <a
                  href={report.source_summary.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-sans text-[11px] text-red-700 hover:underline"
                >
                  View source document &#8599;
                </a>
              )}
            </div>
          </div>
          <div className={`rounded-md px-4 py-3 text-center shrink-0 border ${qc.bg} ${qc.border}`}>
            <div className="font-sans text-[10px] text-gray-500 uppercase tracking-widest mb-1">Data Quality</div>
            <div className={`font-sans font-semibold text-sm capitalize ${qc.text}`}>
              {report.data_quality}
            </div>
          </div>
        </div>
      </div>

      {/* Score + Verdict */}
      <div className="flex gap-3 mb-3 flex-wrap">
        <div className="flex-1 min-w-[220px] bg-white border border-gray-200 rounded-lg px-5 py-5">
          <div className="font-sans text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3.5">
            Consumer Score
          </div>
          <ScoreRing score={report.consumer_score?.score || 5} />
          {report.consumer_score?.rationale && (
            <p className="font-sans text-xs text-gray-500 mt-3.5 leading-relaxed">
              {report.consumer_score.rationale}
            </p>
          )}
        </div>
        <div className="flex-[2] min-w-[300px] bg-white border border-gray-200 rounded-lg px-5 py-5">
          <div className="font-sans text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3.5">
            Analyst Verdict
          </div>
          <p className="font-sans text-sm text-gray-900 leading-relaxed">{report.verdict}</p>
          {report.peer_context && (
            <p className="font-sans text-xs text-gray-500 mt-3 pt-3 border-t border-gray-100 leading-relaxed italic">
              {report.peer_context}
            </p>
          )}
        </div>
      </div>

      {/* Highlights / Warnings / Tips */}
      <div className="flex gap-3 mb-3 flex-wrap">
        {[
          {
            key: "h",
            label: "Strengths",
            items: report.highlights || [],
            twText: "text-emerald-700",
            twBg: "bg-emerald-50",
            twBorder: "border-emerald-200",
            icon: "\u2191",
          },
          {
            key: "w",
            label: "Watch Out For",
            items: report.warnings || [],
            twText: "text-red-700",
            twBg: "bg-red-50",
            twBorder: "border-red-200",
            icon: "\u2193",
          },
        ].map(({ key, label, items, twText, twBg, twBorder, icon }) => (
          <div
            key={key}
            className={`flex-1 min-w-[200px] ${twBg} ${twBorder} border rounded-lg px-4 py-4`}
          >
            <div className={`font-sans text-[10px] font-semibold uppercase tracking-wider mb-3 ${twText}`}>
              {label}
            </div>
            {!items.length && <p className="font-sans text-xs text-gray-500">None identified.</p>}
            {items.map((item, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <span className={`font-mono text-xs shrink-0 mt-0.5 ${twText}`}>
                  {icon}
                </span>
                <span className="font-sans text-[13px] text-gray-900 leading-normal">{item}</span>
              </div>
            ))}
          </div>
        ))}
        {(report.tips || []).length > 0 && (
          <div className="flex-1 min-w-[200px] bg-white border border-gray-200 rounded-lg px-4 py-4">
            <div className="font-sans text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Savings Strategies
            </div>
            {report.tips.map((tip, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <span className="font-mono text-[11px] text-red-700 shrink-0 mt-0.5">{i + 1}.</span>
                <span className="font-sans text-[13px] text-gray-900 leading-normal">{tip}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fee Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-200 flex justify-between items-center">
          <span className="font-sans font-semibold text-[13px] text-gray-900">Extracted Fee Schedule</span>
          {report.source_summary?.url && (
            <a
              href={report.source_summary.url}
              target="_blank"
              rel="noreferrer"
              className="font-sans text-xs text-red-700 hover:underline"
            >
              View source document &#8599;
            </a>
          )}
        </div>
        <FeeTable categories={report.fee_categories} />
        <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-200 font-sans text-[11px] text-gray-400">
          Data sourced from the Bank Fee Index database.
        </div>
      </div>
    </div>
  );
}

// -- Audit result display components ------------------------------------------

export function AuditResultCard({ result }: { result: AuditResult }) {
  const actionColors: Record<string, { bg: string; text: string; label: string }> = {
    validated:  { bg: "bg-emerald-50", text: "text-emerald-700", label: "Validated" },
    cleared:    { bg: "bg-amber-50",   text: "text-amber-700",   label: "Cleared" },
    discovered: { bg: "bg-blue-50",    text: "text-blue-700",    label: "Discovered" },
    ai_found:   { bg: "bg-indigo-50",  text: "text-indigo-700",  label: "AI Found" },
    not_found:  { bg: "bg-red-50",     text: "text-red-700",     label: "Not Found" },
  };

  const ac = actionColors[result.action] || actionColors.not_found;

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-5 py-4 mb-3" style={{ animation: "fadein .3s ease" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="font-sans font-semibold text-[15px] text-gray-900">
          {result.institutionName}
        </div>
        <span className={`${ac.bg} ${ac.text} text-xs font-semibold px-2.5 py-1 rounded-md`}>
          {ac.label}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="font-sans text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
            URL Before
          </div>
          <div className="font-mono text-[11px] text-gray-600 break-all">
            {result.urlBefore || "None"}
          </div>
        </div>
        <div>
          <div className="font-sans text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
            URL After
          </div>
          <div className="font-mono text-[11px] text-gray-600 break-all">
            {result.urlAfter || "None"}
          </div>
        </div>
      </div>
      {(result.discoveryMethod || result.confidence !== null) && (
        <div className="flex gap-4 mt-3 pt-3 border-t border-gray-100">
          {result.discoveryMethod && (
            <div>
              <span className="font-sans text-[10px] text-gray-400 uppercase tracking-wider">Method: </span>
              <span className="font-sans text-xs text-gray-700">{result.discoveryMethod}</span>
            </div>
          )}
          {result.confidence !== null && (
            <div>
              <span className="font-sans text-[10px] text-gray-400 uppercase tracking-wider">Confidence: </span>
              <span className="font-sans text-xs text-gray-700">{Math.round(result.confidence * 100)}%</span>
            </div>
          )}
          {result.reason && (
            <div className="flex-1">
              <span className="font-sans text-[10px] text-gray-400 uppercase tracking-wider">Reason: </span>
              <span className="font-sans text-xs text-gray-500">{result.reason}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BatchProgressBar({ progress }: { progress: { current: number; total: number; institution: string } }) {
  const pct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-5 py-4 mb-4">
      <div className="flex justify-between items-center mb-2">
        <span className="font-sans text-sm font-medium text-gray-900">
          {progress.current} / {progress.total} institutions
        </span>
        <span className="font-sans text-xs text-gray-500 truncate ml-3">
          {progress.institution}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-red-700 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function BatchSummaryGrid({ summary }: { summary: BatchSummary }) {
  const items: [string, number, string][] = [
    ["Total",      summary.total,        "text-gray-900"],
    ["Validated",  summary.validated,     "text-emerald-700"],
    ["Cleared",    summary.cleared,       "text-amber-700"],
    ["Discovered", summary.discovered,    "text-blue-700"],
    ["AI Found",   summary.aiFound,       "text-indigo-700"],
    ["Missing",    summary.stillMissing,  "text-red-700"],
  ];

  return (
    <div className="grid grid-cols-6 gap-3 mb-6" style={{ animation: "fadein .3s ease" }}>
      {items.map(([label, value, color]) => (
        <div key={label} className="bg-white border border-gray-200 rounded-lg p-3 text-center">
          <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</div>
        </div>
      ))}
    </div>
  );
}

// -- Global keyframe styles ---------------------------------------------------

export function ScoutKeyframes() {
  return (
    <style>{`
      @keyframes spin   { to { transform: rotate(360deg); } }
      @keyframes blink  { 0%,100%{opacity:.15} 50%{opacity:1} }
      @keyframes fadein { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
    `}</style>
  );
}

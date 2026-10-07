"use client";

import { useState, useTransition } from "react";
import { runQuery } from "./actions";

const QUERY_GROUPS = [
  {
    label: "Overview",
    queries: [
      { label: "Dashboard stats", sql: "SELECT\n  (SELECT COUNT(*) FROM institution_sources) as institutions,\n  (SELECT COUNT(*) FROM institution_sources WHERE fee_schedule_url IS NOT NULL) as with_url,\n  (SELECT COUNT(DISTINCT institution_id) FROM published_fee_catalog) as with_published_fees,\n  (SELECT COUNT(*) FROM published_fee_catalog) as published_fees,\n  (SELECT COUNT(*) FROM agent_messages WHERE sender_agent = 'knox' AND intent = 'reject') as knox_rejections,\n  (SELECT COUNT(*) FROM agent_runs WHERE status IN ('queued','running')) as active_agent_runs" },
      { label: "Knox decision status", sql: "SELECT\n  CASE\n    WHEN ko.decision IS NULL THEN 'pending'\n    WHEN ko.decision = 'confirm' THEN 'confirmed'\n    WHEN ko.decision = 'override' THEN 'overridden'\n    ELSE 'other'\n  END AS status,\n  COUNT(*) as cnt\nFROM agent_messages am\nLEFT JOIN knox_overrides ko ON ko.rejection_msg_id = am.message_id\nWHERE am.sender_agent = 'knox' AND am.intent = 'reject'\nGROUP BY 1 ORDER BY cnt DESC" },
      { label: "Tables and views", sql: "SELECT table_schema, table_name, table_type\nFROM information_schema.tables\nWHERE table_schema = 'public'\nORDER BY table_type, table_name" },
    ],
  },
  {
    label: "Coverage",
    queries: [
      { label: "By state", sql: "SELECT src.state_code, COUNT(*) as total,\n  SUM(CASE WHEN src.fee_schedule_url IS NOT NULL THEN 1 ELSE 0 END) as with_url,\n  COUNT(DISTINCT ef.institution_id) as with_published_fees\nFROM institution_sources src\nLEFT JOIN published_fee_catalog ef ON src.id = ef.institution_id\nGROUP BY src.state_code ORDER BY total DESC" },
      { label: "By charter type", sql: "SELECT charter_type,\n  COUNT(*) as total,\n  SUM(CASE WHEN fee_schedule_url IS NOT NULL THEN 1 ELSE 0 END) as with_url\nFROM institution_sources GROUP BY charter_type" },
      { label: "Never discovered", sql: "SELECT state_code, COUNT(*) as cnt\nFROM institution_sources\nWHERE (fee_schedule_url IS NULL OR fee_schedule_url = '')\n  AND website_url IS NOT NULL AND website_url != ''\n  AND id NOT IN (SELECT DISTINCT institution_id FROM agent_url_discovery_attempts)\nGROUP BY state_code ORDER BY cnt DESC" },
      { label: "Have URL, no published fees", sql: "SELECT src.institution_name, src.state_code, src.fee_schedule_url\nFROM institution_sources src\nWHERE src.fee_schedule_url IS NOT NULL\n  AND src.id NOT IN (SELECT DISTINCT institution_id FROM published_fee_catalog)\nORDER BY src.asset_size DESC LIMIT 30" },
    ],
  },
  {
    label: "Fees",
    queries: [
      { label: "Top institutions by fee count", sql: "SELECT src.institution_name, src.state_code, src.charter_type, COUNT(*) as fees\nFROM published_fee_catalog ef\nJOIN institution_sources src ON ef.institution_id = src.id\nGROUP BY src.id, src.institution_name, src.state_code, src.charter_type ORDER BY fees DESC LIMIT 20" },
      { label: "Average overdraft by state", sql: "SELECT src.state_code, ROUND(AVG(ef.amount), 2) as avg_overdraft, COUNT(*) as institutions\nFROM published_fee_catalog ef\nJOIN institution_sources src ON ef.institution_id = src.id\nWHERE ef.fee_category = 'overdraft' AND ef.amount > 0\nGROUP BY src.state_code ORDER BY avg_overdraft DESC" },
      { label: "Median fees by category", sql: "SELECT fee_category, COUNT(*) as cnt,\n  ROUND(AVG(amount), 2) as avg_amount,\n  MIN(amount) as min_amount,\n  MAX(amount) as max_amount\nFROM published_fee_catalog\nWHERE amount > 0 AND fee_category IS NOT NULL\nGROUP BY fee_category ORDER BY cnt DESC" },
      { label: "Banks vs CUs (spotlight fees)", sql: "SELECT ef.fee_category, src.charter_type,\n  COUNT(*) as cnt, ROUND(AVG(ef.amount), 2) as avg_fee\nFROM published_fee_catalog ef\nJOIN institution_sources src ON ef.institution_id = src.id\nWHERE ef.amount > 0\n  AND ef.fee_category IN ('overdraft', 'nsf', 'monthly_maintenance', 'atm_non_network', 'wire_domestic_outgoing')\nGROUP BY ef.fee_category, src.charter_type\nORDER BY ef.fee_category, src.charter_type" },
      { label: "Highest overdraft fees", sql: "SELECT src.institution_name, src.state_code, ef.amount, ef.fee_name\nFROM published_fee_catalog ef\nJOIN institution_sources src ON ef.institution_id = src.id\nWHERE ef.fee_category = 'overdraft' AND ef.amount > 0\nORDER BY ef.amount DESC LIMIT 20" },
      { label: "Free checking (no monthly fee)", sql: "SELECT src.institution_name, src.state_code, src.charter_type, ef.amount, ef.conditions\nFROM published_fee_catalog ef\nJOIN institution_sources src ON ef.institution_id = src.id\nWHERE ef.fee_category = 'monthly_maintenance'\n  AND (ef.amount = 0 OR ef.amount IS NULL)\nORDER BY src.asset_size DESC LIMIT 30" },
    ],
  },
  {
    label: "Pipeline",
    queries: [
      { label: "Recent runs", sql: "SELECT id, title, agent_name, status, started_at, completed_at, summary\nFROM agent_runs\nWHERE run_kind IN ('workflow', 'workflow_lane', 'report', 'manual_repair', 'dry_run')\nORDER BY id DESC LIMIT 15" },
      { label: "Discovery hit rate", sql: "SELECT discovery_method, result, COUNT(*) as cnt\nFROM agent_url_discovery_attempts\nGROUP BY discovery_method, result ORDER BY discovery_method, cnt DESC" },
      { label: "Failing institutions", sql: "SELECT institution_name, state_code, consecutive_failures, fee_schedule_url\nFROM institution_sources\nWHERE consecutive_failures >= 3\nORDER BY consecutive_failures DESC LIMIT 20" },
      { label: "Recent Knox decisions", sql: "SELECT ko.decision, COUNT(*) as cnt, MIN(ko.created_at) as earliest, MAX(ko.created_at) as latest\nFROM knox_overrides ko\nGROUP BY ko.decision ORDER BY cnt DESC" },
      { label: "Price changes", sql: "SELECT src.institution_name, fce.fee_category, fce.previous_amount, fce.new_amount, fce.change_type, fce.detected_at\nFROM fee_change_records fce\nJOIN institution_sources src ON fce.institution_id = src.id\nORDER BY fce.detected_at DESC LIMIT 20" },
      { label: "Data source freshness", sql: "SELECT 'FRED' as source, MAX(fetched_at) as last_refresh, COUNT(*) as rows FROM fed_economic_indicators\nUNION ALL SELECT 'Beige Book', MAX(fetched_at), COUNT(*) FROM fed_beige_book\nUNION ALL SELECT 'Fed Content', MAX(fetched_at), COUNT(*) FROM fed_content\nUNION ALL SELECT 'Complaints', MAX(fetched_at), COUNT(*) FROM institution_complaint_records\nUNION ALL SELECT 'Financials', MAX(fetched_at), COUNT(*) FROM institution_financial_records WHERE source IN ('fdic', 'ncua')" },
    ],
  },
];

export function QueryClient() {
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<{
    columns?: string[];
    rows?: Record<string, unknown>[];
    count?: number;
    error?: string;
    duration?: number;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function handleRun() {
    if (!sql.trim()) return;
    startTransition(async () => {
      const res = await runQuery(sql);
      setResult(res);
    });
  }

  function handleExample(query: string) {
    setSql(query);
    startTransition(async () => {
      const res = await runQuery(query);
      setResult(res);
    });
  }

  return (
    <div className="space-y-4">
      {/* Query library */}
      <div className="admin-card p-4">
        <div className="space-y-3">
          {QUERY_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{group.label}</div>
              <div className="flex flex-wrap gap-1.5">
                {group.queries.map((eq) => (
                  <button
                    key={eq.label}
                    onClick={() => handleExample(eq.sql)}
                    disabled={pending}
                    className="rounded-md border border-gray-200 dark:border-white/[0.1] px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.06] hover:border-gray-400 dark:hover:border-white/[0.2] disabled:opacity-40 transition-colors"
                  >
                    {eq.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Query input */}
      <div className="admin-card overflow-hidden">
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder="SELECT * FROM institution_sources LIMIT 10"
          rows={4}
          className="w-full px-4 py-3 text-[13px] font-mono bg-gray-900 dark:bg-gray-950 text-emerald-400 border-0 focus:outline-none focus:ring-0 resize-y"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleRun();
            }
          }}
        />
        <div className="px-4 py-2 bg-gray-50 dark:bg-white/[0.02] border-t border-gray-200 dark:border-white/[0.06] flex items-center justify-between">
          <span className="text-[10px] text-gray-400">
            Cmd+Enter to run. Read-only queries only. Max 500 rows.
          </span>
          <button
            onClick={handleRun}
            disabled={pending || !sql.trim()}
            className="rounded-md bg-gray-900 dark:bg-white/[0.1] px-4 py-1.5 text-[11px] font-semibold text-white hover:bg-gray-800 dark:hover:bg-white/[0.15] disabled:opacity-40 transition-colors"
          >
            {pending ? "Running..." : "Run Query"}
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="admin-card overflow-hidden">
          {result.error ? (
            <div className="px-4 py-3 text-[12px] text-red-500 font-mono">
              {result.error}
            </div>
          ) : (
            <>
              <div className="px-4 py-2 bg-gray-50 dark:bg-white/[0.02] border-b border-gray-200 dark:border-white/[0.06] flex items-center justify-between">
                <span className="text-[11px] text-gray-500">
                  {result.count} row{result.count !== 1 ? "s" : ""}
                  {result.count && result.count > 500 && " (showing first 500)"}
                </span>
                <span className="text-[10px] text-gray-400 tabular-nums">
                  {result.duration}ms
                </span>
              </div>
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-gray-50/95 dark:bg-[oklch(0.16_0_0)]/95 backdrop-blur-sm">
                    <tr className="border-b border-gray-100 dark:border-white/[0.04]">
                      {result.columns?.map((col) => (
                        <th key={col} className="px-3 py-2 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows?.map((row, i) => (
                      <tr key={i} className="border-b border-gray-50 dark:border-white/[0.03] hover:bg-gray-50/50 dark:hover:bg-white/[0.02]">
                        {result.columns?.map((col) => (
                          <td key={col} className="px-3 py-1.5 tabular-nums text-gray-700 dark:text-gray-300 whitespace-nowrap max-w-[300px] truncate" title={String(row[col] ?? "")}>
                            {row[col] === null ? <span className="text-gray-300 dark:text-gray-600 italic">null</span> : String(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

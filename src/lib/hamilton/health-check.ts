/**
 * Hamilton's health check (#1921): three deterministic probes of the paths a Pro reader depends
 * on, read when the morning brief runs, so a broken Hamilton is heard about the same morning.
 *
 *   database  the connection answers, and every table Hamilton reads or saves to exists and
 *             can be read (one `SELECT 1 ... LIMIT 1` each)
 *   ask       the Ask bar's engine answers a fixed fee question for one institution that
 *             publishes that fee, through the same path as the answer eval (`answer-eval.ts`)
 *   export    the analysis PDF (the Analyze screen's download) renders from a fixed synthetic
 *             answer and starts with `%PDF`
 *
 * Read-only and model-free: no provider is called (the Ask engine is deterministic; the written
 * memo is never asked for), nothing is saved, and no customer row is touched. Each probe has its
 * own time limit and never throws; a probe that errors is a failed check with its reason.
 * Internal only; never shown to customers. Incident process: `docs/runbooks/hamilton-incident.md`.
 */

import { sql } from "@/lib/data-store/connection";
import type { AnalyzeResponse } from "./types";

export type HamiltonHealthCheckName = "database" | "ask" | "export";

export interface HamiltonHealthCheck {
  check: HamiltonHealthCheckName;
  ok: boolean;
  /** Why it failed, or what it saw when it passed. */
  reason: string;
  ms: number;
}

export interface HamiltonHealthReport {
  readAt: string;
  checks: HamiltonHealthCheck[];
  failed: number;
}

/** Tables Hamilton reads or saves to; a missing or unreadable one breaks a Pro screen. */
export const HAMILTON_HEALTH_TABLES = [
  "published_fee_catalog",
  "hamilton_saved_analyses",
  "hamilton_reports",
  "hamilton_workspace_contexts",
  "hamilton_decisions",
  "hamilton_decision_events",
  "hamilton_institution_memory",
] as const;

/** The fixed Ask question: a quality-bar question (q04) every publishing institution can answer. */
export const HEALTH_ASK_QUESTION = "How does our overdraft fee compare?";
export const HEALTH_ASK_FEE = "overdraft";

/** Each probe's time limit. The brief's route allows 60 seconds in all; the probes run together. */
export const HEALTH_CHECK_TIMEOUT_MS = 20_000;

/** Longest error text carried into a reason. */
const REASON_CHARS = 200;

export interface AskProbeResult {
  institutionId: number | null;
  kind: string | null;
  shortAnswer: string | null;
  hasResearch: boolean;
}

export interface HamiltonHealthDeps {
  /** Tables from the list that are missing; throws when the database or a table cannot be read. */
  probeDatabase: (tables: readonly string[]) => Promise<{ missing: string[] }>;
  /** The Ask engine's answer to the fixed question, or institutionId null when none publishes the fee. */
  probeAsk: (question: string, feeCategory: string) => Promise<AskProbeResult>;
  /** The rendered analysis PDF's bytes. */
  renderExport: (analysis: AnalyzeResponse) => Promise<Uint8Array>;
  now?: () => number;
}

/**
 * The fixed answer the export probe renders. Synthetic: it is not a claim about any real
 * institution's fees.
 */
export const HEALTH_EXPORT_FIXTURE: AnalyzeResponse = {
  title: "Overdraft at Example Community Bank",
  confidence: { level: "medium", basis: ["Synthetic health-check answer"] },
  hamiltonView: "Example Community Bank charges $30 for an overdraft. Peers sit near $29.",
  whatThisMeans: "The fee is close to the peer median.",
  whyItMatters: ["A fee near the median rarely draws complaints on price alone."],
  evidence: { metrics: [{ label: "Peer median", value: "$29.00" }] },
  exploreFurther: [],
};

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > REASON_CHARS ? `${flat.slice(0, REASON_CHARS - 1)}…` : flat;
}

function errorText(error: unknown): string {
  return clip(error instanceof Error ? error.message : String(error));
}

async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} seconds`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Pure: the database probe's verdict. */
export function databaseVerdict(missing: readonly string[]): { ok: boolean; reason: string } {
  return missing.length > 0
    ? { ok: false, reason: `missing table${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}` }
    : { ok: true, reason: `${HAMILTON_HEALTH_TABLES.length} tables readable` };
}

/** Pure: the Ask probe's verdict. */
export function askVerdict(result: AskProbeResult): { ok: boolean; reason: string } {
  if (result.institutionId === null) return { ok: false, reason: `no institution publishes an ${HEALTH_ASK_FEE} fee` };
  const where = `institution ${result.institutionId}`;
  if (!result.hasResearch) return { ok: false, reason: `the ${HEALTH_ASK_FEE} research for ${where} did not load` };
  if (!result.kind || result.kind === "clarifying_question") {
    return { ok: false, reason: `answered ${where} with a question back instead of the fee's position` };
  }
  if (!result.shortAnswer?.trim()) return { ok: false, reason: `the answer for ${where} was empty` };
  return { ok: true, reason: `answered ${where} (${result.kind.replace(/_/g, " ")})` };
}

/** Pure: the export probe's verdict. */
export function exportVerdict(bytes: Uint8Array): { ok: boolean; reason: string } {
  const head = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
  if (head !== "%PDF-") return { ok: false, reason: "the analysis PDF did not start with %PDF-" };
  if (bytes.length < 1_000) return { ok: false, reason: `the analysis PDF was only ${bytes.length} bytes` };
  return { ok: true, reason: `analysis PDF rendered (${Math.round(bytes.length / 1024)} KB)` };
}

async function timed(
  check: HamiltonHealthCheckName,
  now: () => number,
  work: () => Promise<{ ok: boolean; reason: string }>,
): Promise<HamiltonHealthCheck> {
  const start = now();
  try {
    const verdict = await withTimeout(work(), HEALTH_CHECK_TIMEOUT_MS, `the ${check} check`);
    return { check, ...verdict, ms: now() - start };
  } catch (error) {
    return { check, ok: false, reason: errorText(error), ms: now() - start };
  }
}

/** Runs the three probes together. Never throws. */
export async function runHamiltonHealth(deps: HamiltonHealthDeps, readAt = new Date()): Promise<HamiltonHealthReport> {
  const now = deps.now ?? Date.now;
  const checks = await Promise.all([
    timed("database", now, async () => databaseVerdict((await deps.probeDatabase(HAMILTON_HEALTH_TABLES)).missing)),
    timed("ask", now, async () => askVerdict(await deps.probeAsk(HEALTH_ASK_QUESTION, HEALTH_ASK_FEE))),
    timed("export", now, async () => exportVerdict(await deps.renderExport(HEALTH_EXPORT_FIXTURE))),
  ]);
  return { readAt: readAt.toISOString(), checks, failed: checks.filter((c) => !c.ok).length };
}

const TABLE_NAME = /^[a-z_]+$/;

/** The live probes: the app's own database, the Ask engine and the PDF renderer. */
export function liveHamiltonHealthDeps(): HamiltonHealthDeps {
  return {
    probeDatabase: async (tables) => {
      const rows = (await sql`
        SELECT t AS name, to_regclass('public.' || t) IS NOT NULL AS present
          FROM unnest(${tables as string[]}::text[]) AS t
      `) as unknown as Array<{ name: string; present: boolean }>;
      const missing = rows.filter((row) => !row.present).map((row) => row.name);
      for (const row of rows) {
        // Names come from HAMILTON_HEALTH_TABLES, never from input; the check keeps it that way.
        if (row.present && TABLE_NAME.test(row.name)) await sql.unsafe(`SELECT 1 FROM public.${row.name} LIMIT 1`);
      }
      return { missing };
    },
    probeAsk: async (question, feeCategory) => {
      const [row] = await sql`
        SELECT institution_id FROM published_fee_catalog
         WHERE fee_category = ${feeCategory}
         ORDER BY institution_id
         LIMIT 1
      `;
      if (!row) return { institutionId: null, kind: null, shortAnswer: null, hasResearch: false };
      const institutionId = Number(row.institution_id);
      // The answer eval's engine path: deterministic, read-only, no model call.
      const { answer } = await import("./answer-eval");
      const answered = await answer(institutionId, question, new Map());
      return {
        institutionId,
        kind: answered.response.kind,
        shortAnswer: answered.response.shortAnswer,
        hasResearch: answered.research !== null,
      };
    },
    renderExport: async (analysis) => {
      // Loaded on demand, as the PDF route does, so the brief's import graph stays small.
      const [{ renderToBuffer }, { createElement }, { AnalysisPdfDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("react"),
        import("@/components/hamilton/reports/AnalysisPdfDocument"),
      ]);
      const element = createElement(AnalysisPdfDocument, { analysis, analysisFocus: "Peer Position" });
      const buffer = await renderToBuffer(element as unknown as Parameters<typeof renderToBuffer>[0]);
      return new Uint8Array(buffer);
    },
  };
}

/** The live check, as the morning brief reads it. */
export function readHamiltonHealth({ now = new Date() }: { now?: Date } = {}): Promise<HamiltonHealthReport> {
  return runHamiltonHealth(liveHamiltonHealthDeps(), now);
}

const LABELS: Record<HamiltonHealthCheckName, string> = { database: "database", ask: "Ask", export: "export" };

/**
 * The morning brief's lines: one per failed check, each a thing that needs James. Nothing when
 * every check passed. A report that could not be read at all is itself a failure.
 */
export function hamiltonHealthProblems(report: HamiltonHealthReport | null | undefined, readError?: string | null): string[] {
  if (readError) return [`Hamilton health check could not run: ${clip(readError)}. See docs/runbooks/hamilton-incident.md.`];
  if (!report) return [];
  return report.checks
    .filter((c) => !c.ok)
    .map((c) => `Hamilton ${LABELS[c.check]} check failed: ${c.reason}. See docs/runbooks/hamilton-incident.md.`);
}

/** The run ledger's record of the check. */
export function hamiltonHealthDetail(report: HamiltonHealthReport): Record<string, unknown> {
  return {
    read_at: report.readAt,
    failed: report.failed,
    checks: report.checks.map((c) => ({ check: c.check, ok: c.ok, reason: c.reason, ms: c.ms })),
  };
}

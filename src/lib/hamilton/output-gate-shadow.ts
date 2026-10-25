/**
 * The one output gate in shadow (#1077, claim contract step 4): the unified verdict beside the
 * decision today's gates made, as a small record that rides in the run ledger (an agent run's
 * params, output-gate-shadow-store.ts). Pure: no reads, no writes. The record keeps failure codes
 * and counts, never the answer's text.
 */

import { OUTPUT_GATE_VERSION, gateAnswer, type GateFailureCode, type GateInput, type GateStatus, type GateVerdict } from "./output-gate";

/**
 * What today's gates did with the answer:
 * - `held`: held, withheld or refused;
 * - `shown_partial`: shown with sentences the binding left out;
 * - `shown`: shown whole after the gate passed it;
 * - `shown_ungated`: shown with no gate at all (an admin chat, the Simulate stream).
 */
export type TodayDecision = "held" | "shown" | "shown_partial" | "shown_ungated";

/** Where the unified verdict and today's part ways. */
export type ShadowDisagreement =
  /** Today shows it; the unified gate would hold it. */
  | "unified_holds"
  /** Today holds it; the unified gate would show it (whole or in part). */
  | "unified_shows"
  /** Both show it, but one cuts sentences and the other does not. */
  | "partial_differs";

/** Which caller ran the shadow: the written-answer route's two paths, the Ask memo, Simulate, a report section (#1077 step 6), the replays. */
export type ShadowPath = "written_streaming" | "written_buffered" | "memo" | "simulate_stream" | "simulate_read" | "report_section" | "golden_replay" | "ask_replay";

/**
 * Whose answer the shadow ran on: a reader's (the live routes), the daily paid eval's sample, the
 * golden replay, or the daily gate replay (gate-replay.ts: real questions re-answered by today's free
 * engine). Kept apart in every count, so replayed and synthetic answers never stand in for readers'.
 */
export type ShadowOrigin = "reader" | "paid_eval" | "golden" | "replay";
export const SHADOW_ORIGINS: readonly ShadowOrigin[] = ["reader", "paid_eval", "golden", "replay"];

/** Where a shadow ran, as its record keeps it; `origin` defaults to "reader". */
export interface ShadowContext {
  path: ShadowPath;
  mode?: string | null;
  origin?: ShadowOrigin;
}

export interface GateShadowRecord {
  version: typeof OUTPUT_GATE_VERSION;
  /** Whose answer it was; a record written before this field reads as "reader". */
  origin: ShadowOrigin;
  surface: GateVerdict["surface"];
  path: ShadowPath;
  /** The request's mode string; null when the caller sent none (the admin chats). */
  mode: string | null;
  today: TodayDecision;
  unified: GateStatus;
  agrees: boolean;
  disagreement: ShadowDisagreement | null;
  /** Each failure's code, critical first. */
  codes: GateFailureCode[];
  critical: GateFailureCode[];
  /** True when any failure is a stated cause (today's cause problem lines or the cause rule's shadow input). */
  cause: boolean;
  corrections: number;
  /** `GATE_SHADOW_ERROR` when the unified gate threw: today's decision stands and nothing else is known. */
  error?: string;
  /** Set when step 5's bounded repair ran (HAMILTON_GATE_REPAIR on): statuses, outcome and call count only. */
  repair?: GateShadowRepair;
}

/** The repair's trace in the ledger (output-gate-repair.ts): codes and counts, never text. */
export interface GateShadowRepair {
  firstStatus: GateStatus;
  outcome: string;
  calls: number;
}

/** The one error code a shadow record carries when the unified gate threw. */
export const GATE_SHADOW_ERROR = "gate_threw";

/** The disagreement between today's decision and the unified status, or null when they agree. */
export function shadowDisagreement(today: TodayDecision, unified: GateStatus): ShadowDisagreement | null {
  const todayHeld = today === "held";
  const unifiedHeld = unified === "held";
  if (todayHeld && !unifiedHeld) return "unified_shows";
  if (!todayHeld && unifiedHeld) return "unified_holds";
  if (todayHeld) return null;
  const todayPartial = today === "shown_partial";
  return todayPartial !== (unified === "ready_partial") ? "partial_differs" : null;
}

export function gateShadowRecord(verdict: GateVerdict, today: TodayDecision, context: ShadowContext): GateShadowRecord {
  const disagreement = shadowDisagreement(today, verdict.status);
  const critical = verdict.failures.filter((f) => f.critical).map((f) => f.code);
  return {
    version: OUTPUT_GATE_VERSION,
    origin: context.origin ?? "reader",
    surface: verdict.surface,
    path: context.path,
    mode: context.mode ?? null,
    today,
    unified: verdict.status,
    agrees: disagreement === null,
    disagreement,
    codes: [...critical, ...verdict.failures.filter((f) => !f.critical).map((f) => f.code)],
    critical,
    cause: verdict.failures.some((f) => f.code === "causal_unsupported"),
    corrections: verdict.corrections.length,
  };
}

/**
 * Runs the unified gate in shadow and returns its record. Never throws: a gate error becomes a
 * record with `error` set, so a shadow can never change what today's gates decided.
 */
export function shadowGate(input: GateInput, today: TodayDecision, context: ShadowContext): GateShadowRecord {
  try {
    return gateShadowRecord(gateAnswer(input), today, context);
  } catch {
    // A fixed code, never the error's message: the record carries no answer text or internals.
    return {
      version: OUTPUT_GATE_VERSION, origin: context.origin ?? "reader", surface: input.surface, path: context.path, mode: context.mode ?? null, today,
      unified: "held", agrees: false, disagreement: null, codes: [], critical: [], cause: false, corrections: 0,
      error: GATE_SHADOW_ERROR,
    };
  }
}

/** One set of shadow counts (`tallyGateShadow`, overall and per origin). */
export interface GateShadowCounts {
  total: number;
  agree: number;
  disagree: number;
  errors: number;
  byDisagreement: Record<ShadowDisagreement, number>;
  /** Unified statuses, counted. */
  byStatus: Record<GateStatus, number>;
  /** Today's decisions, counted. */
  byToday: Record<TodayDecision, number>;
  /** Failure codes that made the unified gate hold, counted once per record. */
  heldBy: Partial<Record<GateFailureCode, number>>;
  /** Records the cause rule flagged, and those of them the unified gate holds. */
  cause: { flagged: number; held: number };
  /** The same counts per surface and path ("written_answer/written_streaming"). */
  byPath: Record<string, { total: number; disagree: number; unifiedHolds: number; unifiedShows: number }>;
}

export interface GateShadowTally extends GateShadowCounts {
  /** The same counts for each origin alone: readers' answers, the paid eval's samples, the golden replay. */
  byOrigin: Record<ShadowOrigin, GateShadowCounts>;
}

/**
 * Counts shadow records: the numbers a later step reads before it switches the gate on. The
 * overall counts span every origin; `byOrigin` keeps readers' answers apart from eval samples.
 */
export function tallyGateShadow(records: readonly GateShadowRecord[]): GateShadowTally {
  const byOrigin = Object.fromEntries(
    SHADOW_ORIGINS.map((origin) => [origin, countShadows(records.filter((r) => (r.origin ?? "reader") === origin))]),
  ) as Record<ShadowOrigin, GateShadowCounts>;
  return { ...countShadows(records), byOrigin };
}

function countShadows(records: readonly GateShadowRecord[]): GateShadowCounts {
  const tally: GateShadowCounts = {
    total: 0, agree: 0, disagree: 0, errors: 0,
    byDisagreement: { unified_holds: 0, unified_shows: 0, partial_differs: 0 },
    byStatus: { validated: 0, ready_partial: 0, held: 0 },
    byToday: { held: 0, shown: 0, shown_partial: 0, shown_ungated: 0 },
    heldBy: {}, cause: { flagged: 0, held: 0 }, byPath: {},
  };
  for (const record of records) {
    tally.total += 1;
    if (record.error) { tally.errors += 1; continue; }
    tally.byToday[record.today] += 1;
    tally.byStatus[record.unified] += 1;
    if (record.agrees) tally.agree += 1;
    else tally.disagree += 1;
    if (record.disagreement) tally.byDisagreement[record.disagreement] += 1;
    if (record.unified === "held") for (const code of new Set(record.critical)) tally.heldBy[code] = (tally.heldBy[code] ?? 0) + 1;
    if (record.cause) {
      tally.cause.flagged += 1;
      if (record.unified === "held") tally.cause.held += 1;
    }
    const key = `${record.surface}/${record.path}`;
    const path = tally.byPath[key] ??= { total: 0, disagree: 0, unifiedHolds: 0, unifiedShows: 0 };
    path.total += 1;
    if (!record.agrees) path.disagree += 1;
    if (record.disagreement === "unified_holds") path.unifiedHolds += 1;
    if (record.disagreement === "unified_shows") path.unifiedShows += 1;
  }
  return tally;
}

/** A record read back from the ledger, defensively: anything malformed reads as null. */
function readRepair(value: unknown, statuses: readonly string[]): { repair: GateShadowRepair } | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (typeof r.firstStatus !== "string" || !statuses.includes(r.firstStatus) || typeof r.outcome !== "string" || typeof r.calls !== "number") return null;
  return { repair: { firstStatus: r.firstStatus as GateStatus, outcome: r.outcome, calls: r.calls } };
}

export function readGateShadowRecord(value: unknown): GateShadowRecord | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const todays: readonly string[] = ["held", "shown", "shown_partial", "shown_ungated"];
  const statuses: readonly string[] = ["validated", "ready_partial", "held"];
  if (obj.version !== OUTPUT_GATE_VERSION || typeof obj.today !== "string" || !todays.includes(obj.today)) return null;
  if (typeof obj.unified !== "string" || !statuses.includes(obj.unified) || typeof obj.surface !== "string" || typeof obj.path !== "string") return null;
  const codes = Array.isArray(obj.codes) ? obj.codes.filter((c): c is GateFailureCode => typeof c === "string") : [];
  const critical = Array.isArray(obj.critical) ? obj.critical.filter((c): c is GateFailureCode => typeof c === "string") : [];
  const disagreement = shadowDisagreement(obj.today as TodayDecision, obj.unified as GateStatus);
  // A record written before origins were kept is a reader's: only the live routes recorded then.
  const origin: ShadowOrigin = typeof obj.origin === "string" && (SHADOW_ORIGINS as readonly string[]).includes(obj.origin) ? obj.origin as ShadowOrigin : "reader";
  return {
    version: OUTPUT_GATE_VERSION, origin, surface: obj.surface as GateShadowRecord["surface"], path: obj.path as ShadowPath,
    mode: typeof obj.mode === "string" ? obj.mode : null, today: obj.today as TodayDecision, unified: obj.unified as GateStatus,
    agrees: typeof obj.error === "string" ? false : disagreement === null, disagreement: typeof obj.error === "string" ? null : disagreement,
    codes, critical, cause: obj.cause === true, corrections: typeof obj.corrections === "number" ? obj.corrections : 0,
    ...(typeof obj.error === "string" ? { error: obj.error } : {}),
    ...(readRepair(obj.repair, statuses) ?? {}),
  };
}

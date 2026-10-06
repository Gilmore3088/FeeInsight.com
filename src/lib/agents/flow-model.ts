import { STEP_OWNER } from "./narrate";
import type { AdminAgent } from "./types";

/**
 * Pure model for the live flow page (safe to import from client components):
 * the agent order, move/now types, and the plain-English sentences.
 */

export const FLOW_AGENTS: Array<{ agent: AdminAgent; name: string; job: string; href: string }> = [
  { agent: "atlas", name: "Atlas", job: "Starts each state's pass and hands work down the line", href: "/admin/atlas/details" },
  { agent: "magellan", name: "Magellan", job: "Finds and downloads each bank's fee schedule", href: "/admin/magellan" },
  { agent: "rosetta", name: "Rosetta", job: "Opens the document and turns it into text", href: "/admin/rosetta" },
  { agent: "knox", name: "Knox", job: "Pulls the fees out of the text", href: "/admin/knox" },
  { agent: "darwin", name: "Darwin", job: "Checks every fee before it counts", href: "/admin/darwin" },
  { agent: "hamilton", name: "Hamilton", job: "Publishes checked fees to the site", href: "/admin/hamilton" },
];

export const INSTITUTION_STEPS = ["discover", "rescue", "fetch", "read", "extract", "classify", "publish"];

export type MoveTone = "ok" | "warn" | "error";

export interface FlowMove {
  key: string;
  at: string;
  agent: AdminAgent;
  stateCode: string | null;
  institutionId: number;
  institutionName: string;
  text: string;
  tone: MoveTone;
}

export interface FlowNow {
  agent: AdminAgent;
  state: "working" | "queued" | "idle";
  /** e.g. "Working in FL" or "Next up in FL, DE". */
  text: string;
}

export interface FlowSnapshot {
  moves: FlowMove[];
  now: FlowNow[];
  /** Live fee count per institution that just went live. */
  liveFees?: Record<number, number>;
  generatedAt: string;
}

export type FlowWaiting = Record<Exclude<AdminAgent, "atlas">, number> & { published: number; total: number };

export type Sample = Record<string, unknown>;

function plainHttp(reason: unknown): string {
  const text = String(reason ?? "");
  if (/404/.test(text)) return "page not found";
  if (/403/.test(text)) return "the site blocked us";
  if (/429/.test(text)) return "the site asked us to slow down";
  if (/fetch failed|network|timeout/i.test(text)) return "the site didn't answer";
  return text ? text.toLowerCase() : "unknown error";
}

/** Turns a checker's internal reason into a few plain words. */
export function plainReason(reason: unknown): string {
  const text = String(reason ?? "");
  if (/category guard|category_mismatch|name_contradicts|name_unsupported/i.test(text)) return "the fee name doesn't match its type";
  if (/outside|envelope|plausible range/i.test(text)) return "the amount looks wrong for this kind of fee";
  if (/identical|already published|already verified|duplicate/i.test(text)) return "duplicate of one we already have";
  if (/thin|fewer than|minimum/i.test(text)) return "the bank has too few fees so far";
  if (!text) return "failed a check";
  const lower = text.toLowerCase();
  return lower.length > 70 ? `${lower.slice(0, 67)}...` : lower;
}

function fees(count: number): string {
  return `${count} fee${count === 1 ? "" : "s"}`;
}

/**
 * One institution's totals for a fee step (extract, classify, publish), counted over every
 * result of the step, not the ten sample rows. A step records these as `institution_results`
 * so the board's counts match what the agent actually did.
 */
export interface InstitutionTally {
  institution_id: number;
  /** Fees the step handled: inserted (extract), checked (classify) or offered (publish). */
  total: number;
  /** Fees that went through: inserted, passed, or published. */
  ok: number;
  /** Publish only: fees already live with the same value. */
  already_live: number;
  /** The first reason a fee was held back, if any. */
  reason: string | null;
}

function emptyTally(institutionId: number): InstitutionTally {
  return { institution_id: institutionId, total: 0, ok: 0, already_live: 0, reason: null };
}

const ALREADY_LIVE = /identical|already published/i;

/** Pure: per-institution totals for a fee step, in the order institutions first appear. */
export function tallyByInstitution(stepKey: string, samples: Sample[]): InstitutionTally[] {
  const tallies = new Map<number, InstitutionTally>();
  for (const sample of samples) {
    const id = Number(sample.institution_id ?? 0);
    const tally = tallies.get(id) ?? emptyTally(id);
    tallies.set(id, tally);
    if (stepKey === "extract") {
      const inserted = Number(sample.inserted ?? 0);
      tally.total += inserted;
      tally.ok += inserted;
      continue;
    }
    tally.total += 1;
    const passed = stepKey === "publish" ? sample.status === "published" : sample.status === "verified";
    if (passed) {
      tally.ok += 1;
    } else if (stepKey === "publish" && ALREADY_LIVE.test(String(sample.reason ?? ""))) {
      tally.already_live += 1;
    } else if (tally.reason === null) {
      tally.reason = sample.reason == null ? "" : String(sample.reason);
    }
  }
  return [...tallies.values()];
}

/** Pure: one plain sentence for one institution's totals in a fee step. */
export function describeTally(stepKey: string, tally: InstitutionTally): { text: string; tone: MoveTone } {
  const held = tally.total - tally.ok - tally.already_live;
  if (stepKey === "extract") {
    return tally.ok > 0
      ? { text: `Pulled ${fees(tally.ok)} out of the document`, tone: "ok" }
      : { text: "Found no fees in the document", tone: "warn" };
  }
  if (stepKey === "publish") {
    if (tally.ok === 0) {
      if (held === 0) return { text: "Already live; nothing new to publish", tone: "ok" };
      const live = tally.already_live > 0 ? `, ${tally.already_live} already live` : "";
      return { text: `Held back ${fees(held)} (${plainReason(tally.reason)})${live}`, tone: "warn" };
    }
    const extras = [
      tally.already_live > 0 ? `${tally.already_live} already live` : null,
      held > 0 ? `${held} held back` : null,
    ].filter(Boolean);
    return { text: `Published ${fees(tally.ok)} to the site${extras.length > 0 ? `, ${extras.join(", ")}` : ""}`, tone: "ok" };
  }
  if (held === 0) return { text: `Checked ${fees(tally.ok)}: all passed`, tone: "ok" };
  if (tally.ok === 0) return { text: `Held back ${fees(held)} (${plainReason(tally.reason)})`, tone: "warn" };
  return { text: `Checked ${fees(tally.total)}: ${tally.ok} passed, ${held} held back`, tone: "ok" };
}

/** Pure: one plain sentence for what an agent did to one institution. */
export function describeSamples(stepKey: string, samples: Sample[]): { text: string; tone: MoveTone } {
  const first = samples[0] ?? {};
  const status = String(first.status ?? first.outcome ?? "");
  switch (stepKey) {
    case "discover":
    case "rescue":
      if (status === "discovered") return { text: "Found the fee schedule", tone: "ok" };
      if (status === "retry_after") return { text: "Website didn't answer; will try again later", tone: "warn" };
      if (status === "needs_human") return { text: "Couldn't find it; needs a person to look", tone: "warn" };
      return { text: `No fee schedule found (${plainHttp(first.reason)})`, tone: "error" };
    case "fetch":
      if (status === "success") return { text: "Downloaded the fee schedule", tone: "ok" };
      if (status === "unchanged") return { text: "Checked it: no change since last time", tone: "ok" };
      if (status === "skipped") return { text: "Skipped the download", tone: "warn" };
      return { text: `Couldn't download it (${plainHttp(first.reason)})`, tone: "error" };
    case "read":
      if (status === "completed") return { text: "Read the document", tone: "ok" };
      if (status === "wrong_document") return { text: "Not a fee schedule; sent back to Magellan", tone: "warn" };
      if (status === "needs_ocr") return { text: "Scanned image; waiting for text recognition", tone: "warn" };
      if (status === "deferred") return { text: "Scanned image; will read it next pass", tone: "warn" };
      if (status === "empty" || status === "skipped") return { text: "Page needs a browser to show its text", tone: "warn" };
      return { text: `Couldn't open the document (${plainHttp(first.error)})`, tone: "error" };
    case "extract":
    case "classify":
    case "publish":
      return describeTally(stepKey, tallyByInstitution(stepKey, samples)[0] ?? emptyTally(0));
    default:
      return { text: "Handled", tone: "ok" };
  }
}

export function toObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return value as Record<string, unknown>;
}

/** Pure: turn finished-step events into one move per institution per step. */
export function movesFromEvents(rows: Array<Record<string, unknown>>, names: Map<number, string>): FlowMove[] {
  const moves: FlowMove[] = [];
  for (const row of rows) {
    const stepKey = String(row.step_key ?? "");
    const detail = toObject(row.detail);
    const push = (institutionId: number, fallbackName: string, { text, tone }: { text: string; tone: MoveTone }) =>
      moves.push({
        key: `${String(row.id)}-${institutionId}`,
        at: new Date(row.created_at as string | Date).toISOString(),
        agent: STEP_OWNER[stepKey] ?? "atlas",
        stateCode: row.state_code ? String(row.state_code) : null,
        institutionId,
        institutionName: names.get(institutionId) ?? fallbackName,
        text,
        tone,
      });
    const samples = Array.isArray(detail.sample_results) ? (detail.sample_results as Sample[]) : [];
    // Fee steps record every institution's real totals; older events only have the samples.
    if (Array.isArray(detail.institution_results)) {
      for (const tally of detail.institution_results as InstitutionTally[]) {
        const institutionId = Number(tally.institution_id);
        if (!Number.isFinite(institutionId) || institutionId <= 0) continue;
        push(institutionId, `Institution ${institutionId}`, describeTally(stepKey, tally));
      }
      continue;
    }
    const byInstitution = new Map<number, Sample[]>();
    for (const sample of samples) {
      const id = Number(sample.institution_id);
      if (!Number.isFinite(id) || id <= 0) continue;
      byInstitution.set(id, [...(byInstitution.get(id) ?? []), sample]);
    }
    for (const [institutionId, group] of byInstitution) {
      push(institutionId, String(group[0].institution_name ?? `Institution ${institutionId}`), describeSamples(stepKey, group));
    }
  }
  return moves;
}

/** A Hamilton move that put at least one fee on the site. */
export function isWentLive(move: FlowMove): boolean {
  return move.agent === "hamilton" && move.text.startsWith("Published");
}

/**
 * Pure: an agent's latest moves, one per institution. A bank with several documents, or
 * handled by two of the agent's steps, shows once with its newest result.
 */
export function latestPerInstitution(moves: FlowMove[], keep: (move: FlowMove) => boolean, limit: number): FlowMove[] {
  const seen = new Set<number>();
  const out: FlowMove[] = [];
  for (const move of moves) {
    if (!keep(move) || seen.has(move.institutionId)) continue;
    seen.add(move.institutionId);
    out.push(move);
    if (out.length === limit) break;
  }
  return out;
}

function stateList(codes: string[]): string {
  const unique = [...new Set(codes)].sort();
  if (unique.length <= 4) return unique.join(", ");
  return `${unique.slice(0, 4).join(", ")} and ${unique.length - 4} more`;
}

/** Pure: what each agent is doing now, from the steps of active runs. */
export function nowFromSteps(rows: Array<Record<string, unknown>>): FlowNow[] {
  return FLOW_AGENTS.map(({ agent }) => {
    const mine = rows.filter((row) => (STEP_OWNER[String(row.step_key)] ?? String(row.agent_name)) === agent);
    const states = (status: string) =>
      mine.filter((row) => row.status === status).map((row) => String(row.state_code ?? "all states"));
    if (agent === "atlas") {
      const runs = new Set(rows.map((row) => String(row.run_id))).size;
      const allStates = rows.map((row) => String(row.state_code ?? "all states"));
      return runs > 0
        ? { agent, state: "working", text: `Running ${runs} pass${runs === 1 ? "" : "es"}: ${stateList(allStates)}` }
        : { agent, state: "idle", text: "No passes running" };
    }
    const running = states("running");
    if (running.length > 0) return { agent, state: "working", text: `Working in ${stateList(running)}` };
    const queued = states("queued");
    if (queued.length > 0) return { agent, state: "queued", text: `Next up in ${stateList(queued)}` };
    return { agent, state: "idle", text: "Nothing to do this minute" };
  });
}

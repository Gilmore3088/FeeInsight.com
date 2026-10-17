/**
 * One Ask conversation's state (#979, H04-T02). Pure and typed: the Analyze screen holds it, the
 * conversation store (`chat-memory.ts`) keeps a bounded snapshot of it per answered turn, and a
 * reload, a back/forward visit or a reopened saved answer starts from that snapshot.
 *
 * What it holds: the conversation's ID once stored, the research subject (H01), each turn (its
 * question, one-line answer, route and the saved answer it was filed as), the active peer list
 * (H02: the exact peer IDs and dated sources a follow-up may refine), the engine decision a
 * follow-up about the same fee continues, and a pending clarification from Hamilton.
 *
 * What resets: "New conversation" and a change of subject start a fresh state. A subject change
 * is never silent: the fresh state records which institution the earlier answers were about.
 * A clarification ends when it is answered, cancelled or a new question is asked.
 *
 * A stored snapshot is untrusted when it comes back: `parseConversationState` checks its shape
 * and bounds, and the caller checks its subject against the authorized institution.
 */
import { validatePeerListContinuation, type PeerListContinuation } from "./peer-list";

export const CONVERSATION_STATE_VERSION = 1;
/** Turns kept in a stored snapshot, newest kept. The written answer carries only the last three. */
export const MAX_STORED_TURNS = 20;
const QUESTION_CHARS = 500;
const LEAD_CHARS = 280;
const PROMPT_CHARS = 300;
const VALUE_CHARS = 200;

export type TurnRoute = "structured" | "peer_list" | "written" | "market_brief";
export type TurnStatus = "pending" | "answered" | "failed";
export type ClarificationInputKind = "number" | "percent" | "text";

export interface ConversationTurnRecord {
  id: string;
  question: string;
  /** The answer's one-line lead, once known. */
  lead: string | null;
  route: TurnRoute | null;
  status: TurnStatus;
  /** The saved answer (hamilton_saved_analyses.id) this turn was filed as, when one was. */
  savedAnalysisId: string | null;
}

export interface PendingClarification {
  turnId: string;
  fieldKey: string;
  prompt: string;
  inputKind: ClarificationInputKind;
  /** The last reply Hamilton could not read, so the composer says why it asks again. */
  invalidValue: string | null;
}

/** The peer list a follow-up may refine: frozen IDs and sources from the turn that listed them. */
export interface ActivePeerSet {
  snapshot: PeerListContinuation;
  /** The ask (nonce) that produced or last refined the list; a follow-up must come straight after. */
  answeredNonce: number;
  answeredQuestion: string;
}

/** The engine decision (one fee, one subject) a follow-up that names no other fee continues. */
export interface CarriedDecision {
  decisionId: string;
  feeCategory: string | null;
}

export interface ConversationSubject {
  institutionId: string | null;
  institutionName: string | null;
}

export interface HamiltonConversationState {
  version: typeof CONVERSATION_STATE_VERSION;
  /** hamilton_conversations.id once the conversation is stored; null before its first answer. */
  conversationId: string | null;
  /** Bumped by every change, so the store never lets an older snapshot replace a newer one. */
  revision: number;
  subject: ConversationSubject;
  /** Counts asks in this conversation (the Analyze screen's nonce). */
  nonce: number;
  turns: ConversationTurnRecord[];
  peerSet: ActivePeerSet | null;
  decision: CarriedDecision | null;
  clarification: PendingClarification | null;
  /** Set on a fresh state started by a subject change: whom the earlier answers were about. */
  previousSubject: ConversationSubject | null;
}

export type ConversationAction =
  | { type: "ask"; question: string; route?: TurnRoute | null; previousLead?: string | null }
  | { type: "answered"; turnId: string; lead?: string | null; route?: TurnRoute | null; savedAnalysisId?: string | null }
  | { type: "failed"; turnId: string }
  | { type: "clarify"; turnId: string; question: { fieldKey: string; prompt: string; inputKind: string } | null; invalidValue?: string | null }
  | { type: "cancelClarification" }
  | { type: "peerSet"; value: ActivePeerSet | null }
  | { type: "decision"; value: CarriedDecision | null }
  | { type: "stored"; conversationId: string };

export function emptyConversation(subject: ConversationSubject, previousSubject: ConversationSubject | null = null): HamiltonConversationState {
  return {
    version: CONVERSATION_STATE_VERSION,
    conversationId: null,
    revision: 0,
    subject: { institutionId: subject.institutionId ?? null, institutionName: subject.institutionName ?? null },
    nonce: 0,
    turns: [],
    peerSet: null,
    decision: null,
    clarification: null,
    previousSubject: previousSubject && previousSubject.institutionId !== subject.institutionId ? previousSubject : null,
  };
}

/** "New conversation": nothing carried, same subject. */
export function resetConversation(state: HamiltonConversationState): HamiltonConversationState {
  return emptyConversation(state.subject);
}

/**
 * A different research subject starts a fresh conversation, never a silent relabel: the earlier
 * turns, peer list, decision and clarification all belong to the old subject. The fresh state
 * names the old subject so the screen can say the earlier answers are not carried.
 */
export function switchSubject(state: HamiltonConversationState, subject: ConversationSubject): HamiltonConversationState {
  if (subject.institutionId === state.subject.institutionId) return state;
  return emptyConversation(subject, state.turns.length > 0 ? state.subject : state.previousSubject);
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export function currentTurn(state: HamiltonConversationState): ConversationTurnRecord | null {
  return state.turns.at(-1) ?? null;
}

/** True when `turnId` is still the conversation's latest turn; late work for an older one is dropped. */
export function isCurrentTurn(state: HamiltonConversationState, turnId: string): boolean {
  return currentTurn(state)?.id === turnId;
}

function bump(state: HamiltonConversationState, next: Partial<HamiltonConversationState>): HamiltonConversationState {
  return { ...state, ...next, revision: state.revision + 1 };
}

function withTurn(state: HamiltonConversationState, turnId: string, change: Partial<ConversationTurnRecord>): HamiltonConversationState {
  if (!isCurrentTurn(state, turnId)) return state;
  return bump(state, { turns: state.turns.map((t) => (t.id === turnId ? { ...t, ...change } : t)) });
}

function clarificationKind(kind: string): ClarificationInputKind | null {
  return kind === "number" || kind === "percent" || kind === "text" ? kind : null;
}

export function conversationReducer(state: HamiltonConversationState, action: ConversationAction): HamiltonConversationState {
  switch (action.type) {
    case "ask": {
      const question = oneLine(action.question, QUESTION_CHARS);
      if (!question) return state;
      const last = currentTurn(state);
      const previousLead = action.previousLead ? oneLine(action.previousLead, LEAD_CHARS) : null;
      // The answer just read keeps its lead; asking the same question again retries it in place.
      const settled = last && previousLead && !last.lead ? state.turns.map((t) => (t.id === last.id ? { ...t, lead: previousLead } : t)) : state.turns;
      const nonce = state.nonce + 1;
      const turn: ConversationTurnRecord = {
        id: `t${nonce}`,
        question,
        lead: null,
        route: action.route ?? null,
        status: "pending",
        savedAnalysisId: null,
      };
      const turns = last && last.question === question ? [...settled.slice(0, -1), turn] : [...settled, turn];
      return bump(state, { nonce, turns: turns.slice(-MAX_STORED_TURNS), clarification: null });
    }
    case "answered":
      return withTurn(state, action.turnId, {
        status: "answered",
        ...(action.lead !== undefined ? { lead: action.lead ? oneLine(action.lead, LEAD_CHARS) : null } : {}),
        ...(action.route ? { route: action.route } : {}),
        ...(action.savedAnalysisId ? { savedAnalysisId: action.savedAnalysisId } : {}),
      });
    case "failed":
      return withTurn(state, action.turnId, { status: "failed" });
    case "clarify": {
      if (!isCurrentTurn(state, action.turnId)) return state;
      const kind = action.question ? clarificationKind(action.question.inputKind) : null;
      if (!action.question || !kind) return state.clarification ? bump(state, { clarification: null }) : state;
      return bump(state, {
        clarification: {
          turnId: action.turnId,
          fieldKey: action.question.fieldKey,
          prompt: oneLine(action.question.prompt, PROMPT_CHARS),
          inputKind: kind,
          invalidValue: action.invalidValue ? oneLine(action.invalidValue, VALUE_CHARS) : null,
        },
      });
    }
    case "cancelClarification":
      return state.clarification ? bump(state, { clarification: null }) : state;
    case "peerSet":
      return bump(state, { peerSet: action.value });
    case "decision":
      return bump(state, { decision: action.value });
    case "stored":
      return state.conversationId === action.conversationId ? state : bump(state, { conversationId: action.conversationId });
  }
}

/** Earlier turns, oldest first, for a written answer's bounded context block. */
export function earlierTurns(state: HamiltonConversationState): Array<{ question: string; lead: string | null }> {
  return state.turns.slice(0, -1).map((t) => ({ question: t.question, lead: t.lead }));
}

/**
 * The engine decision a new question continues. A question that names a different fee starts its
 * own decision, so its prices and tested scenarios never land on the earlier fee's record.
 */
export function decisionForQuestion(state: HamiltonConversationState, questionFee: string | null): string | null {
  const carried = state.decision;
  if (!carried) return null;
  if (questionFee && carried.feeCategory && questionFee !== carried.feeCategory) return null;
  return carried.decisionId;
}

export type ComposerMode =
  | { kind: "question"; label: string }
  | { kind: "clarification"; label: string; placeholder: string; inputMode: "numeric" | "decimal" | "text"; fieldKey: string; invalidValue: string | null };

/** The one composer's mode: an ordinary question, or the answer to Hamilton's pending question. */
export function composerMode(state: HamiltonConversationState, hasAnswer: boolean): ComposerMode {
  const c = state.clarification;
  if (!c) return { kind: "question", label: hasAnswer ? "Ask a follow-up" : "Your question" };
  return {
    kind: "clarification",
    label: `Answer Hamilton's question: ${c.prompt}`,
    placeholder: c.inputKind === "number" ? "A number, for example 12,000" : c.inputKind === "percent" ? "A percentage, for example 8%" : "Your answer",
    inputMode: c.inputKind === "number" ? "numeric" : c.inputKind === "percent" ? "decimal" : "text",
    fieldKey: c.fieldKey,
    invalidValue: c.invalidValue,
  };
}

/**
 * Checks a reply in the composer before it is sent, with the server's own reading rules
 * (`ask-service.ts`): a number is zero or more, with commas, "$" or "%" allowed; a percentage is
 * at most 100. Returns the line to show, or null when the reply can be sent.
 */
export function clarificationInputError(kind: ClarificationInputKind, raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Type an answer, or choose Ask something else instead.";
  if (value.length > VALUE_CHARS) return `Keep the answer to ${VALUE_CHARS} characters or fewer.`;
  if (kind === "text") return null;
  const n = Number(value.replace(/[,$%\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return kind === "percent" ? "Enter a percentage, for example 8%." : "Enter a number, for example 12,000.";
  if (kind === "percent" && (value.includes("%") || n > 1 ? n / 100 : n) > 1) return "A percentage can be at most 100%.";
  return null;
}

// ---- Stored snapshots -------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAVED_ID = /^[A-Za-z0-9_-]{1,80}$/;
const INSTITUTION_ID = /^\d{1,12}$/;

export function isConversationId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? oneLine(value, max) : null;
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
}

function readSubject(raw: unknown): ConversationSubject | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const id = s.institutionId === null ? null : typeof s.institutionId === "string" && INSTITUTION_ID.test(s.institutionId) ? s.institutionId : undefined;
  if (id === undefined) return null;
  return { institutionId: id, institutionName: str(s.institutionName, 200) };
}

function readTurn(raw: unknown): ConversationTurnRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const id = typeof t.id === "string" && /^t\d{1,7}$/.test(t.id) ? t.id : null;
  const question = str(t.question, QUESTION_CHARS);
  const route = t.route === null || t.route === undefined ? null : (["structured", "peer_list", "written", "market_brief"] as const).find((r) => r === t.route);
  const status = (["pending", "answered", "failed"] as const).find((s) => s === t.status);
  if (!id || !question || route === undefined || !status) return null;
  const saved = typeof t.savedAnalysisId === "string" && SAVED_ID.test(t.savedAnalysisId) ? t.savedAnalysisId : null;
  return { id, question, lead: str(t.lead, LEAD_CHARS), route, status, savedAnalysisId: saved };
}

function readPeerSet(raw: unknown): ActivePeerSet | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  // The peer list contract's own check: valid IDs, dated sources, selected IDs from the list.
  const snapshot = validatePeerListContinuation(p.snapshot);
  const nonce = int(p.answeredNonce);
  const answeredQuestion = str(p.answeredQuestion, QUESTION_CHARS);
  if (!snapshot || nonce === null || !answeredQuestion) return null;
  return { snapshot, answeredNonce: nonce, answeredQuestion };
}

function readDecision(raw: unknown): CarriedDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const decisionId = typeof d.decisionId === "string" && SAVED_ID.test(d.decisionId) ? d.decisionId : null;
  if (!decisionId) return null;
  const fee = typeof d.feeCategory === "string" && /^[a-z0-9_]{2,60}$/.test(d.feeCategory) ? d.feeCategory : null;
  return { decisionId, feeCategory: fee };
}

/**
 * A stored snapshot read back. Returns null for anything malformed, never a partial guess. A
 * pending clarification is not restored: a reload asks the question again rather than accepting a
 * reply to a question the screen no longer shows.
 */
export function parseConversationState(raw: unknown): HamiltonConversationState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  if (s.version !== CONVERSATION_STATE_VERSION) return null;
  const subject = readSubject(s.subject);
  const revision = int(s.revision);
  const nonce = int(s.nonce);
  if (!subject || revision === null || nonce === null || !Array.isArray(s.turns) || s.turns.length > MAX_STORED_TURNS) return null;
  const turns: ConversationTurnRecord[] = [];
  for (const t of s.turns) {
    const turn = readTurn(t);
    if (!turn) return null;
    turns.push(turn);
  }
  const peerSet = s.peerSet === null || s.peerSet === undefined ? null : readPeerSet(s.peerSet);
  if (s.peerSet && !peerSet) return null;
  // A peer list from another institution is never carried into this subject's conversation.
  const ownPeerSet = peerSet && peerSet.snapshot.originInstitutionId === subject.institutionId ? peerSet : null;
  return {
    version: CONVERSATION_STATE_VERSION,
    conversationId: isConversationId(s.conversationId) ? s.conversationId : null,
    revision,
    subject,
    nonce,
    turns,
    peerSet: ownPeerSet,
    decision: readDecision(s.decision),
    clarification: null,
    previousSubject: s.previousSubject ? readSubject(s.previousSubject) : null,
  };
}

/** The snapshot to store: the state itself, minus a clarification (never restored). */
export function serializeConversationState(state: HamiltonConversationState): HamiltonConversationState {
  return { ...state, clarification: null, turns: state.turns.slice(-MAX_STORED_TURNS) };
}

/**
 * The state as it stood when a saved answer was filed: its turns up to and including that answer.
 * Returns null when the snapshot holds no turn for it. The reopened answer continues as a new
 * conversation (no stored ID), so a follow-up never rewrites the original conversation's later turns.
 */
export function stateAtSavedAnswer(state: HamiltonConversationState, savedAnalysisId: string): HamiltonConversationState | null {
  const at = state.turns.findIndex((t) => t.savedAnalysisId === savedAnalysisId);
  if (at < 0) return null;
  const turns = state.turns.slice(0, at + 1);
  const nonce = Number(turns[at].id.slice(1));
  // A peer list from a later turn is not part of this answer's state.
  const peerSet = state.peerSet && state.peerSet.answeredNonce <= nonce ? state.peerSet : null;
  const decision = at === state.turns.length - 1 ? state.decision : null;
  return { ...state, conversationId: null, nonce, turns, peerSet, decision, clarification: null };
}

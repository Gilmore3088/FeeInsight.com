/**
 * Hamilton Chat Memory — migration-backed conversation persistence.
 *
 * Tables:
 *   hamilton_conversations — one row per conversation session
 *   hamilton_messages     — one row per turn (user or assistant)
 *
 * Schema changes live in Supabase migrations.
 * All queries use the shared postgres sql client from data-store/connection.
 *
 * Security: loadConversationHistory is scoped to (conversation_id, user_id)
 * to prevent cross-user history access (T-17-04).
 */

import { sql } from "@/lib/data-store/connection";
import {
  parseConversationState,
  serializeConversationState,
  stateAtSavedAnswer,
  type HamiltonConversationState,
} from "./conversation-state";

/** The key under hamilton_messages.tool_calls that holds an Ask conversation's state snapshot. */
export const CONVERSATION_STATE_KEY = "hamiltonConversationState";

type Sql = typeof sql;

export interface ConversationSummary {
  id: string;
  title: string | null;
  updatedAt: string;
}

/**
 * Create a new conversation for a user. Returns the UUID string of the new row.
 */
export async function createConversation(userId: number, db: Sql = sql): Promise<string> {
  const [row] = await db`
    INSERT INTO hamilton_conversations (user_id)
    VALUES (${userId})
    RETURNING id
  ` as Array<{ id: string }>;

  return row.id;
}

/**
 * Append a message to a conversation. Also bumps updated_at on the parent conversation.
 */
export async function appendMessage(
  conversationId: string,
  userId: number,
  role: "user" | "assistant",
  content: string,
  tokenCount?: number
): Promise<void> {
  const rows = await sql<Array<{ id: string }>>`
    INSERT INTO hamilton_messages (conversation_id, user_id, role, content, token_count)
    SELECT id, user_id, ${role}, ${content}, ${tokenCount ?? null}
      FROM hamilton_conversations
     WHERE id = ${conversationId} AND user_id = ${userId}
    RETURNING id
  `;
  if (rows.length === 0) throw new Error("Conversation not found");

  await sql`
    UPDATE hamilton_conversations
    SET updated_at = NOW()
    WHERE id = ${conversationId} AND user_id = ${userId}
  `;
}

/**
 * Load the most recent `limit` messages for a conversation, in chronological order.
 *
 * T-17-04: scoped to (conversation_id, user_id) to prevent cross-user access.
 * Returns plain objects — the API route converts to UIMessage shape.
 */
export async function loadConversationHistory(
  conversationId: string,
  userId: number,
  limit = 20,
  db: Sql = sql,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  // Verify the conversation belongs to this user (T-17-04)
  const [conv] = await db`
    SELECT id FROM hamilton_conversations
    WHERE id = ${conversationId} AND user_id = ${userId}
  ` as Array<{ id: string }>;

  if (!conv) return [];

  // The most recent `limit` messages, returned oldest-first.
  const rows = await db`
    SELECT role, content
    FROM (
      SELECT role, content, created_at
      FROM hamilton_messages
      WHERE conversation_id = ${conversationId}
        -- Analyze state snapshots are not chat turns.
        AND (tool_calls IS NULL OR NOT (tool_calls ? ${CONVERSATION_STATE_KEY}))
      ORDER BY created_at DESC
      LIMIT ${limit}
    ) recent
    ORDER BY created_at ASC
  ` as Array<{ role: "user" | "assistant"; content: string }>;

  return rows;
}

/**
 * List conversations for a user, ordered by most recently updated.
 */
export async function listConversations(
  userId: number,
  limit = 30
): Promise<ConversationSummary[]> {
  const rows = await sql`
    SELECT id, title, updated_at
    FROM hamilton_conversations
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  ` as Array<{ id: string; title: string | null; updated_at: string }>;

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updated_at,
  }));
}

/**
 * Update the title of a conversation (e.g., auto-generated from the first user message).
 */
export async function updateConversationTitle(
  conversationId: string,
  userId: number,
  title: string
): Promise<void> {
  await sql`
    UPDATE hamilton_conversations
    SET title = ${title}, updated_at = NOW()
    WHERE id = ${conversationId} AND user_id = ${userId}
  `;
}


/**
 * Stores one Analyze conversation state snapshot (#979, H04-T06) as a hamilton_messages row whose
 * tool_calls holds the snapshot; no new column. Scoped to (conversation_id, user_id): another
 * user's conversation ID is refused. A snapshot no newer than the stored one (by revision) is
 * ignored, so a late save from an older turn never replaces a newer one. Returns false when the
 * conversation is not this user's or the snapshot is stale or malformed.
 */
export async function saveConversationState(
  conversationId: string,
  userId: number,
  raw: unknown,
  db: Sql = sql,
): Promise<boolean> {
  const parsed = parseConversationState(raw);
  if (!parsed) return false;
  const state = serializeConversationState({ ...parsed, conversationId });
  const latest = state.turns.at(-1);
  const content = (latest?.lead ?? latest?.question ?? "Conversation state").slice(0, 1000);
  const rows = await db<Array<{ id: string }>>`
    INSERT INTO hamilton_messages (conversation_id, user_id, role, content, tool_calls)
    SELECT c.id, c.user_id, 'assistant', ${content}, ${db.json({ [CONVERSATION_STATE_KEY]: state } as never)}
      FROM hamilton_conversations c
     WHERE c.id = ${conversationId} AND c.user_id = ${String(userId)}
       AND NOT EXISTS (
         SELECT 1 FROM hamilton_messages m
          WHERE m.conversation_id = c.id
            AND m.tool_calls ? ${CONVERSATION_STATE_KEY}
            AND (m.tool_calls -> ${CONVERSATION_STATE_KEY} ->> 'revision')::int >= ${state.revision}
       )
    RETURNING id
  `;
  if (rows.length === 0) return false;
  const first = state.turns[0]?.question;
  await db`
    UPDATE hamilton_conversations
       SET updated_at = NOW(), title = COALESCE(title, ${first ? first.slice(0, 120) : null})
     WHERE id = ${conversationId} AND user_id = ${String(userId)}
  `;
  return true;
}

/** The newest stored state of this user's conversation, or null (not theirs, none stored, malformed). */
export async function loadConversationState(
  conversationId: string,
  userId: number,
  db: Sql = sql,
): Promise<HamiltonConversationState | null> {
  const rows = await db<Array<{ state: unknown }>>`
    SELECT m.tool_calls -> ${CONVERSATION_STATE_KEY} AS state
      FROM hamilton_messages m
      JOIN hamilton_conversations c ON c.id = m.conversation_id
     WHERE c.id = ${conversationId} AND c.user_id = ${String(userId)}
       AND m.tool_calls ? ${CONVERSATION_STATE_KEY}
     ORDER BY (m.tool_calls -> ${CONVERSATION_STATE_KEY} ->> 'revision')::int DESC, m.created_at DESC
     LIMIT 1
  `;
  const state = rows[0] ? parseConversationState(rows[0].state) : null;
  return state ? { ...state, conversationId } : null;
}

/**
 * The conversation state as it stood when this user's saved answer was filed, for reopening it
 * (#979, H04-T06). The earliest snapshot that holds the answer is the one stored when it was
 * answered. The result carries no conversation ID: a follow-up continues as a new conversation.
 */
export async function loadConversationStateForSavedAnswer(
  savedAnalysisId: string,
  userId: number,
  db: Sql = sql,
): Promise<HamiltonConversationState | null> {
  const rows = await db<Array<{ state: unknown }>>`
    SELECT m.tool_calls -> ${CONVERSATION_STATE_KEY} AS state
      FROM hamilton_messages m
      JOIN hamilton_conversations c ON c.id = m.conversation_id
     WHERE c.user_id = ${String(userId)}
       AND m.tool_calls ? ${CONVERSATION_STATE_KEY}
       AND m.tool_calls -> ${CONVERSATION_STATE_KEY} -> 'turns' @> ${db.json([{ savedAnalysisId }] as never)}
     ORDER BY m.created_at ASC
     LIMIT 1
  `;
  const state = rows[0] ? parseConversationState(rows[0].state) : null;
  return state ? stateAtSavedAnswer(state, savedAnalysisId) : null;
}

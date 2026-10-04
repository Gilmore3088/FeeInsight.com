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

export interface ConversationSummary {
  id: string;
  title: string | null;
  updatedAt: string;
}

/**
 * Create a new conversation for a user. Returns the UUID string of the new row.
 */
export async function createConversation(userId: number): Promise<string> {
  const [row] = await sql`
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
  limit = 20
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  // Verify the conversation belongs to this user (T-17-04)
  const [conv] = await sql`
    SELECT id FROM hamilton_conversations
    WHERE id = ${conversationId} AND user_id = ${userId}
  ` as Array<{ id: string }>;

  if (!conv) return [];

  // The most recent `limit` messages, returned oldest-first.
  const rows = await sql`
    SELECT role, content
    FROM (
      SELECT role, content, created_at
      FROM hamilton_messages
      WHERE conversation_id = ${conversationId}
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

"use server";

/**
 * Stores the Analyze conversation (#979, H04-T06) in hamilton_conversations and
 * hamilton_messages, so a reload, back/forward visit or reopened saved answer resumes it. The
 * signed-in user owns every row; another user's conversation ID is refused. The browser's
 * snapshot is checked by `parseConversationState` and never chooses whose data is read: a
 * reopened conversation's subject is resolved again on the server.
 */
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { createConversation, saveConversationState } from "@/lib/hamilton/chat-memory";
import { isConversationId } from "@/lib/hamilton/conversation-state";

export async function startAnalyzeConversationAction(): Promise<{ id: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) return { error: "Active subscription required" };
  try {
    return { id: await createConversation(user.id) };
  } catch {
    return { error: "This conversation could not be saved." };
  }
}

export async function recordAnalyzeConversationAction(conversationId: string, state: unknown): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user) || !isConversationId(conversationId)) return { ok: false };
  try {
    return { ok: await saveConversationState(conversationId, user.id, state) };
  } catch {
    return { ok: false };
  }
}

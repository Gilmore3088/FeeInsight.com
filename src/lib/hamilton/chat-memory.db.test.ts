/**
 * Real PostgreSQL checks of the Analyze conversation store (#979, H04-T06 and H04-T09) against
 * the production schema (tests/e2e/production-schema.sql) on a loopback-only database. Synthetic
 * users 900001 and 900002 only; their rows are removed before and after.
 */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createConversation, loadConversationHistory, loadConversationState, loadConversationStateForSavedAnswer, saveConversationState,
} from "./chat-memory";
import { conversationReducer, emptyConversation, serializeConversationState, type ConversationAction, type HamiltonConversationState } from "./conversation-state";

const connection = process.env.E2E_DATABASE_URL;
const OWNER = 900001;
const OTHER = 900002;
const SAVED = "11111111-2222-4333-8444-555555555555";

function state(...actions: ConversationAction[]): HamiltonConversationState {
  return actions.reduce(conversationReducer, emptyConversation({ institutionId: "101", institutionName: "Synthetic CU" }));
}

describe.skipIf(!connection)("Analyze conversation store in isolated PostgreSQL", () => {
  let db: ReturnType<typeof postgres>;
  type Db = NonNullable<Parameters<typeof saveConversationState>[3]>;
  const asDb = () => db as unknown as Db;
  const cleanup = async () => {
    await db`DELETE FROM hamilton_messages WHERE conversation_id IN (SELECT id FROM hamilton_conversations WHERE user_id IN (${String(OWNER)}, ${String(OTHER)}))`;
    await db`DELETE FROM hamilton_conversations WHERE user_id IN (${String(OWNER)}, ${String(OTHER)})`;
  };
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) throw new Error("Conversation store tests require a loopback E2E database; production connections are forbidden");
    db = postgres(connection, { max: 1, ssl: "require" });
  });
  beforeEach(cleanup);
  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.end();
    }
  });

  const answered = state(
    { type: "ask", question: "What is the overdraft fee?" },
    { type: "answered", turnId: "t1", route: "written", lead: "The overdraft fee is $30.", savedAnalysisId: SAVED },
  );

  it("stores and reloads the owner's newest snapshot", async () => {
    const id = await createConversation(OWNER, asDb());
    expect(await saveConversationState(id, OWNER, serializeConversationState(answered), asDb())).toBe(true);
    const next = conversationReducer(answered, { type: "ask", question: "And the NSF fee?", previousLead: "The overdraft fee is $30." });
    expect(await saveConversationState(id, OWNER, next, asDb())).toBe(true);
    const back = await loadConversationState(id, OWNER, asDb());
    expect(back?.conversationId).toBe(id);
    expect(back?.turns.map((t) => t.question)).toEqual(["What is the overdraft fee?", "And the NSF fee?"]);
    const [conversation] = await db`SELECT title FROM hamilton_conversations WHERE id = ${id}`;
    expect(conversation.title).toBe("What is the overdraft fee?");
  });

  it("never lets an older snapshot replace a newer one", async () => {
    const id = await createConversation(OWNER, asDb());
    const newer = conversationReducer(answered, { type: "ask", question: "Newer question?" });
    expect(await saveConversationState(id, OWNER, newer, asDb())).toBe(true);
    expect(await saveConversationState(id, OWNER, answered, asDb())).toBe(false);
    expect((await loadConversationState(id, OWNER, asDb()))?.turns.at(-1)?.question).toBe("Newer question?");
  });

  it("refuses another user's conversation ID for reading and writing (H04-T09)", async () => {
    const id = await createConversation(OWNER, asDb());
    await saveConversationState(id, OWNER, answered, asDb());
    expect(await loadConversationState(id, OTHER, asDb())).toBeNull();
    const hijack = conversationReducer(answered, { type: "ask", question: "Written by someone else" });
    expect(await saveConversationState(id, OTHER, hijack, asDb())).toBe(false);
    expect((await loadConversationState(id, OWNER, asDb()))?.turns).toHaveLength(1);
    expect(await loadConversationStateForSavedAnswer(SAVED, OTHER, asDb())).toBeNull();
  });

  it("rejects a malformed snapshot without writing", async () => {
    const id = await createConversation(OWNER, asDb());
    expect(await saveConversationState(id, OWNER, { version: 1, turns: "all of them" }, asDb())).toBe(false);
    const [{ n }] = await db`SELECT count(*)::int AS n FROM hamilton_messages WHERE conversation_id = ${id}`;
    expect(n).toBe(0);
  });

  it("reopens a saved answer at the state it was filed with, as a new conversation", async () => {
    const id = await createConversation(OWNER, asDb());
    await saveConversationState(id, OWNER, answered, asDb());
    const later = conversationReducer(answered, { type: "ask", question: "Later question?" });
    await saveConversationState(id, OWNER, later, asDb());
    const reopened = await loadConversationStateForSavedAnswer(SAVED, OWNER, asDb());
    expect(reopened?.conversationId).toBeNull();
    expect(reopened?.turns.map((t) => t.question)).toEqual(["What is the overdraft fee?"]);
  });

  it("keeps state snapshots out of the chat history", async () => {
    const id = await createConversation(OWNER, asDb());
    await saveConversationState(id, OWNER, answered, asDb());
    expect(await loadConversationHistory(id, OWNER, 20, asDb())).toEqual([]);
  });
});

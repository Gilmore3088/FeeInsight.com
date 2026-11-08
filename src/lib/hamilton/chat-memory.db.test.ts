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
import { peerListReferencesUnchanged, type PeerListRow } from "./peer-list";

const connection = process.env.E2E_DATABASE_URL;
const OWNER = 900001;
const OTHER = 900002;
const SAVED = "11111111-2222-4333-8444-555555555555";

function state(...actions: ConversationAction[]): HamiltonConversationState {
  return actions.reduce(conversationReducer, emptyConversation({ institutionId: "101", institutionName: "Synthetic CU" }));
}

describe.skipIf(!connection)("Analyze conversation store in isolated PostgreSQL", () => {
  let db: ReturnType<typeof postgres>;
  let fixtureDatabase: string | null = null;
  let fixtureVerified = false;
  type Db = NonNullable<Parameters<typeof saveConversationState>[3]>;
  const asDb = (client = db) => client as unknown as Db;
  const verifyFixture = async (client: ReturnType<typeof postgres>) => {
    try {
      const [identity] = await client`SELECT current_database() AS name, host(inet_server_addr()) AS address`;
      if (identity?.name !== fixtureDatabase || !["127.0.0.1", "::1"].includes(identity?.address)) {
        throw new Error("Unrecognized fixture");
      }
    } catch {
      throw new Error("Conversation store tests require the named loopback fixture database");
    }
  };
  const freshConnection = async <T,>(read: (client: ReturnType<typeof postgres>) => Promise<T>): Promise<T> => {
    const client = postgres(connection!, { max: 1, ssl: "require", connect_timeout: 5 });
    try {
      await verifyFixture(client);
      const [writer] = await db`SELECT pg_backend_pid() AS pid`;
      const [reader] = await client`SELECT pg_backend_pid() AS pid`;
      expect(reader.pid).not.toBe(writer.pid);
      return await read(client);
    } finally {
      await client.end();
    }
  };
  const persistedRows = async (id: string, client = db) => {
    const [rows] = await client`
      SELECT to_jsonb(c) AS conversation,
             COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at, m.id)
                         FROM hamilton_messages m WHERE m.conversation_id = c.id), '[]'::jsonb) AS messages
        FROM hamilton_conversations c WHERE c.id = ${id} AND c.user_id = ${String(OWNER)}
    `;
    return rows;
  };
  const cleanup = async () => {
    if (!fixtureVerified) throw new Error("Conversation fixture identity was not verified");
    await db`DELETE FROM hamilton_messages WHERE conversation_id IN (SELECT id FROM hamilton_conversations WHERE user_id IN (${String(OWNER)}, ${String(OTHER)}))`;
    await db`DELETE FROM hamilton_conversations WHERE user_id IN (${String(OWNER)}, ${String(OTHER)})`;
  };
  beforeAll(async () => {
    try {
      const target = new URL(connection!);
      const database = target.pathname.slice(1);
      const allowedFixture = database === "e2e" || (!process.env.CI && /^engineering_conversation_[0-9]{8}$/.test(database));
      if (!["postgres:", "postgresql:"].includes(target.protocol)
          || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
          || !allowedFixture || target.search || target.hash
          || connection!.split("@").length > 2) throw new Error("Unrecognized fixture");
      fixtureDatabase = database;
    } catch {
      throw new Error("Conversation store tests require the named loopback fixture database");
    }
    db = postgres(connection!, { max: 1, ssl: "require", connect_timeout: 5 });
    await verifyFixture(db);
    fixtureVerified = true;
  });
  beforeEach(cleanup);
  afterAll(async () => {
    if (db) {
      try {
        if (fixtureVerified) await cleanup();
      } finally {
        await db.end();
      }
    }
  });

  const answered = state(
    { type: "ask", question: "What is the overdraft fee?" },
    { type: "answered", turnId: "t1", route: "written", lead: "The overdraft fee is $30.", savedAnalysisId: SAVED },
  );

  // CP-09/10: literal synthetic peer history, including order, source dates and a refinement.
  // This is conversation state; no hamilton_saved_analyses row can substitute for it.
  const peerHistory: HamiltonConversationState = {
    version: 1, conversationId: null, revision: 5, nonce: 2,
    subject: { institutionId: "101", institutionName: "Synthetic CU" },
    turns: [
      { id: "t1", question: "List two similar credit unions", lead: "Two similar credit unions are listed.", route: "peer_list", status: "answered", savedAnalysisId: SAVED },
      { id: "t2", question: "Only Florida", lead: "Both selected credit unions are in Florida.", route: "peer_list", status: "answered", savedAnalysisId: null },
    ],
    peerSet: {
      snapshot: {
        originQuestion: "List two similar credit unions", originInstitutionId: "101", originSubjectId: 101,
        originRows: [
          { institutionId: 203, recordId: 4203, reportDate: "2026-09-30", source: "ncua" },
          { institutionId: 202, recordId: 4202, reportDate: "2026-06-30", source: "ncua" },
        ],
        selectedIds: [203, 202], refinedState: "FL",
      },
      answeredNonce: 2, answeredQuestion: "Only Florida",
    },
    decision: null, clarification: null, previousSubject: null,
  };

  it("CP-10: an allocated shell has no restorable history on a fresh connection", async () => {
    const id = await createConversation(OWNER, asDb());
    await freshConnection(async (reader) => {
      const [shell] = await reader`SELECT id FROM hamilton_conversations WHERE id = ${id} AND user_id = ${String(OWNER)}`;
      expect(shell.id).toBe(id);
      expect(await loadConversationState(id, OWNER, asDb(reader))).toBeNull();
      expect(await loadConversationState(id, OTHER, asDb(reader))).toBeNull();
      const [{ n }] = await reader`SELECT count(*)::int AS n FROM hamilton_messages WHERE conversation_id = ${id}`;
      expect(n).toBe(0);
    });
  });

  it("CP-09: a fresh owner connection restores the exact stored turns, subject and dated ordered peers", async () => {
    const id = await createConversation(OWNER, asDb());
    expect(await saveConversationState(id, OWNER, peerHistory, asDb())).toBe(true);
    await freshConnection(async (reader) => {
      const back = await loadConversationState(id, OWNER, asDb(reader));
      expect(back).toEqual({ ...peerHistory, conversationId: id });
      expect(back?.turns.map((turn) => [turn.question, turn.lead])).toEqual([
        ["List two similar credit unions", "Two similar credit unions are listed."],
        ["Only Florida", "Both selected credit unions are in Florida."],
      ]);
      expect(back?.peerSet?.snapshot.originRows).toEqual([
        { institutionId: 203, recordId: 4203, reportDate: "2026-09-30", source: "ncua" },
        { institutionId: 202, recordId: 4202, reportDate: "2026-06-30", source: "ncua" },
      ]);
      const rows = await reader`
        SELECT user_id::text AS owner_id, tool_calls -> 'hamiltonConversationState' AS snapshot
          FROM hamilton_messages WHERE conversation_id = ${id}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ owner_id: String(OWNER), snapshot: { ...peerHistory, conversationId: id } });
    });
  });

  it("CP-10: another owner cannot read or replace peer history and every original row stays unchanged", async () => {
    const id = await createConversation(OWNER, asDb());
    expect(await saveConversationState(id, OWNER, peerHistory, asDb())).toBe(true);
    const original = await persistedRows(id);
    await freshConnection(async (reader) => {
      expect(await loadConversationState(id, OTHER, asDb(reader))).toBeNull();
      expect(await loadConversationHistory(id, OTHER, 20, asDb(reader))).toEqual([]);
      expect(await loadConversationStateForSavedAnswer(SAVED, OTHER, asDb(reader))).toBeNull();
      const hijack = conversationReducer(peerHistory, { type: "ask", question: "Replace another owner's history" });
      expect(await saveConversationState(id, OTHER, hijack, asDb(reader))).toBe(false);
      expect(await persistedRows(id, reader)).toEqual(original);
      expect(await loadConversationState(id, OWNER, asDb(reader))).toEqual({ ...peerHistory, conversationId: id });
    });
  });

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
    const original = await persistedRows(id);
    expect(await saveConversationState(id, OWNER, answered, asDb())).toBe(false);
    await freshConnection(async (reader) => {
      expect(await loadConversationState(id, OWNER, asDb(reader))).toEqual({ ...newer, conversationId: id });
      expect(await persistedRows(id, reader)).toEqual(original);
    });
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
    const original = await persistedRows(id);
    const reopened = await freshConnection((reader) => loadConversationStateForSavedAnswer(SAVED, OWNER, asDb(reader)));
    expect(reopened?.conversationId).toBeNull();
    expect(reopened?.turns.map((t) => t.question)).toEqual(["What is the overdraft fee?"]);
    if (!reopened) throw new Error("The fixture saved answer did not reopen");
    const forkId = await createConversation(OWNER, asDb());
    const fork = conversationReducer(reopened, { type: "ask", question: "A follow-up in the reopened answer?" });
    expect(await saveConversationState(forkId, OWNER, fork, asDb())).toBe(true);
    await freshConnection(async (reader) => {
      expect(await persistedRows(id, reader)).toEqual(original);
      expect(await loadConversationState(id, OWNER, asDb(reader))).toEqual({ ...later, conversationId: id });
      expect((await loadConversationState(forkId, OWNER, asDb(reader)))?.turns.at(-1)?.question).toBe("A follow-up in the reopened answer?");
    });
  });

  it("preserves peer reference identity through an actual JSONB save and fresh owner read", async () => {
    const rows: PeerListRow[] = [
      { institutionId: 203, name: "Synthetic Peer 203", charterType: "credit_union", city: "Orlando", stateCode: "FL", totalAssetsUsd: 1_000_000_000, recordId: 4203, reportDate: "2026-09-30", source: "ncua", sourceUrl: null, feeCoverage: "not_found", inclusionReason: "Synthetic fixture." },
      { institutionId: 202, name: "Synthetic Peer 202", charterType: "credit_union", city: "Orlando", stateCode: "FL", totalAssetsUsd: 1_000_000_000, recordId: 4202, reportDate: "2026-06-30", source: "ncua", sourceUrl: null, feeCoverage: "not_found", inclusionReason: "Synthetic fixture." },
    ];
    const id = await createConversation(OWNER, asDb());
    expect(await saveConversationState(id, OWNER, peerHistory, asDb())).toBe(true);
    await freshConnection(async (reader) => {
      const back = await loadConversationState(id, OWNER, asDb(reader));
      expect(back).toEqual({ ...peerHistory, conversationId: id });
      if (!back?.peerSet) throw new Error("The exact fixture peer history was not restored");
      expect(back.peerSet.snapshot.originRows).toEqual([
        { institutionId: 203, recordId: 4203, reportDate: "2026-09-30", source: "ncua" },
        { institutionId: 202, recordId: 4202, reportDate: "2026-06-30", source: "ncua" },
      ]);
      expect(peerListReferencesUnchanged(rows, back.peerSet.snapshot)).toBe(true);
    });
  });

  it("keeps state snapshots out of the chat history", async () => {
    const id = await createConversation(OWNER, asDb());
    await saveConversationState(id, OWNER, answered, asDb());
    expect(await loadConversationHistory(id, OWNER, 20, asDb())).toEqual([]);
  });
});

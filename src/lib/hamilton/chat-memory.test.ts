import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const mocks = vi.hoisted(() => {
  const state: {
    sqlCalls: Array<{ text: string; values: unknown[] }>;
    queuedRows: unknown[][];
  } = {
    sqlCalls: [],
    queuedRows: [],
  };

  const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    state.sqlCalls.push({ text: strings.join("?"), values });
    return Promise.resolve(state.queuedRows.shift() ?? []);
  });

  return { state, sqlMock };
});

vi.mock("@/lib/data-store/connection", () => ({
  sql: mocks.sqlMock,
}));

import { appendMessage, loadConversationHistory } from "./chat-memory";

const SOURCE = readFileSync(resolve(__dirname, "chat-memory.ts"), "utf-8");
const CHAT_MEMORY_MIGRATION = readFileSync(
  resolve(
    __dirname,
    "../../../docs/archive/supabase-migrations-2026-08-16/20260815083700_hamilton_chat_memory_tables.sql",
  ),
  "utf-8",
);

describe("Hamilton chat memory", () => {
  beforeEach(() => {
    mocks.state.sqlCalls.length = 0;
    mocks.state.queuedRows.length = 0;
    mocks.sqlMock.mockClear();
  });

  it("keeps table DDL in migrations rather than runtime helpers", () => {
    expect(SOURCE).not.toContain("ensureHamiltonTables");
    expect(SOURCE).not.toMatch(/\bCREATE TABLE\b/i);
    expect(SOURCE).not.toMatch(/\bALTER TABLE\b/i);
    expect(SOURCE).not.toMatch(/\bCREATE INDEX\b/i);
    expect(CHAT_MEMORY_MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.hamilton_conversations");
    expect(CHAT_MEMORY_MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.hamilton_messages");
    expect(CHAT_MEMORY_MIGRATION).toContain("user_id integer NOT NULL");
    expect(CHAT_MEMORY_MIGRATION).toContain("tool_calls jsonb");
    expect(CHAT_MEMORY_MIGRATION).toContain("idx_hamilton_msg_user");
  });

  it("appends a message by copying user lineage from the parent conversation", async () => {
    mocks.state.queuedRows.push([{ id: "message-1" }], []);

    await appendMessage(
      "e7f37394-d8dd-49ef-a842-e453c89415b5",
      7,
      "user",
      "Show institution 2945",
      12,
    );

    expect(mocks.state.sqlCalls[0].text).toContain(
      "INSERT INTO hamilton_messages (conversation_id, user_id, role, content, token_count)",
    );
    expect(mocks.state.sqlCalls[0].text).toContain("SELECT id, user_id");
    expect(mocks.state.sqlCalls[0].values).toEqual([
      "user",
      "Show institution 2945",
      12,
      "e7f37394-d8dd-49ef-a842-e453c89415b5",
      7,
    ]);
    expect(mocks.state.sqlCalls[1].text).toContain("UPDATE hamilton_conversations");
  });

  it("throws when appending to a missing conversation", async () => {
    mocks.state.queuedRows.push([]);

    await expect(
      appendMessage(
        "e7f37394-d8dd-49ef-a842-e453c89415b5",
        7,
        "assistant",
        "No conversation",
      ),
    ).rejects.toThrow("Conversation not found");
  });

  it("loads conversation history only after user-scoped ownership check", async () => {
    mocks.state.queuedRows.push(
      [{ id: "conversation-1" }],
      [{ role: "user", content: "Analyze institution 2945" }],
    );

    const rows = await loadConversationHistory(
      "e7f37394-d8dd-49ef-a842-e453c89415b5",
      7,
      10,
    );

    expect(rows).toEqual([{ role: "user", content: "Analyze institution 2945" }]);
    expect(mocks.state.sqlCalls[0].text).toContain("WHERE id =");
    expect(mocks.state.sqlCalls[0].text).toContain("AND user_id =");
    expect(mocks.state.sqlCalls[0].values).toEqual([
      "e7f37394-d8dd-49ef-a842-e453c89415b5",
      7,
    ]);
  });
});

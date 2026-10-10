import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fixture = vi.hoisted(() => ({
  userId: 11,
  tables: {} as Record<string, Record<string, unknown>[]>,
  queries: [] as string[],
  renderToBuffer: vi.fn(),
  memberships: vi.fn(),
}));

// Predicate-sensitive synthetic storage: removing a user/subject condition exposes the
// other fixture's secret and fails these behavioral tests. No live database is used.
vi.mock("@/lib/data-store/connection", () => ({
  sql: vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.reduce((query, part, index) => query + (index ? `$${index}` : "") + part, "").replace(/\s+/g, " ").trim();
    fixture.queries.push(text);
    const table = text.match(/(?:FROM|UPDATE) (hamilton_[a-z_]+)/i)?.[1];
    if (!table) throw new Error(`Unexpected fixture query: ${text}`);
    let rows = fixture.tables[table] ?? [];
    const where = text.slice(text.indexOf("WHERE"));
    for (const field of ["id", "user_id", "institution_id", "conversation_id"]) {
      const match = where.match(new RegExp(`\\b${field}(?:::text)?\\s*=\\s*\\$(\\d+)`, "i"));
      if (match) rows = rows.filter((row) => String(row[field]) === String(values[Number(match[1]) - 1]));
    }
    if (/status = 'active'/.test(where)) rows = rows.filter((row) => row.status === "active");
    if (/status = 'generated'/.test(where)) rows = rows.filter((row) => row.status === "generated");
    if (/superseded_at IS NULL/.test(where)) rows = rows.filter((row) => row.superseded_at == null);
    if (/^UPDATE hamilton_saved_analyses/.test(text)) {
      for (const row of rows) row.response_json = values[0];
    }
    return rows.map((row) => table === "hamilton_messages" ? { role: row.role, content: row.content } : { ...row });
  }),
  withTransaction: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => ({ id: fixture.userId, role: "premium", subscription_status: "active" })) }));
vi.mock("@/lib/access", () => ({ canAccessPremium: () => true }));
vi.mock("@/lib/analytics-server", () => ({ trackFirstHamiltonUse: vi.fn() }));
vi.mock("@/lib/api-hardening/route-wrapper", () => ({ withApiRoutePolicy: (_route: string, _method: string, handler: unknown) => handler }));
vi.mock("@/app/pro/(hamilton)/reports/actions", () => ({ loadPublishedReport: vi.fn(async () => null) }));
vi.mock("@/lib/data-store", () => ({ getInstitutionById: vi.fn(async () => null) }));
vi.mock("@/lib/hamilton/active-peer-set", () => ({ getActivePeerSet: vi.fn(async () => null) }));
vi.mock("@/lib/hamilton/answer-brief", () => ({ loadAnswerBrief: vi.fn(async () => null) }));
vi.mock("@/lib/hamilton/institution-membership", () => ({ getUserInstitutionMemberships: fixture.memberships }));
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: fixture.renderToBuffer }));
vi.mock("@/components/hamilton/reports/PdfDocument", () => ({ PdfDocument: () => null }));
vi.mock("@/components/hamilton/reports/AnalysisPdfDocument", () => ({ AnalysisPdfDocument: () => null }));

import { loadAnalysisRecord } from "@/app/pro/(hamilton)/analyze/actions";
import { POST } from "@/app/api/pro/report-pdf/route";
import { getMemoryFacts, getUpload } from "@/lib/data-store/hamilton-workspace";
import { getSavedAnalysisResponse, updateSavedAnalysisResponse } from "@/lib/data-store/hamilton-analyses";
import { appendMessage, loadConversationHistory } from "./chat-memory";
import { getHamiltonReportById } from "./pro-tables";
import { loadHamiltonAccountContext } from "./account-context-store";
import type { AnalyzeResponse } from "./types";

const REPORT = "11111111-1111-4111-8111-111111111111";
const ANALYSIS = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const UPLOAD = "44444444-4444-4444-8444-444444444444";
const SECRET = "Synthetic owner-only detail";

function exportPdf(body: Record<string, unknown>) {
  return POST(new NextRequest("http://localhost/api/pro/report-pdf", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.userId = 11;
  fixture.queries.length = 0;
  fixture.renderToBuffer.mockResolvedValue(Buffer.from("%PDF synthetic renderer"));
  fixture.tables = {
    hamilton_reports: [{ id: REPORT, user_id: 11, institution_id: "101", status: "generated", report_type: "peer_brief", report_json: { title: SECRET }, created_at: "2026-10-10" }],
    hamilton_saved_analyses: [{ id: ANALYSIS, user_id: 11, institution_id: "101", status: "active", analysis_focus: "overdraft", prompt: "Synthetic question", response_json: JSON.stringify({ title: SECRET }) }],
    hamilton_conversations: [{ id: CONVERSATION, user_id: 11 }],
    hamilton_messages: [{ conversation_id: CONVERSATION, user_id: 11, role: "assistant", content: SECRET }],
    hamilton_institution_memory: [
      { id: "memory-owner-a", user_id: 11, institution_id: 101, field_key: "fee.overdraft.annual_items", value: 111, given_by: "Fixture owner", source: "answer", created_at: "2026-10-10" },
      { id: "memory-owner-b", user_id: 11, institution_id: 202, field_key: "fee.overdraft.annual_items", value: 222, given_by: "Fixture owner", source: "answer", created_at: "2026-10-10" },
    ],
    hamilton_uploads: [{ id: UPLOAD, user_id: 11, institution_id: 101, file_name: "synthetic.csv", status: "mapped", column_map: { secret: SECRET }, created_at: "2026-10-10" }],
  };
});

describe("H01-AC4 private workspace boundaries with two synthetic accounts", () => {
  it("reopens a private report for its owner and refuses the same ID for another user", async () => {
    expect((await getHamiltonReportById(REPORT, 11))?.report_json.title).toBe(SECRET);
    expect(await getHamiltonReportById(REPORT, 22)).toBeNull();
  });

  it("uses the actual analysis loader's authenticated owner scope", async () => {
    expect((await loadAnalysisRecord(ANALYSIS))?.responseJson.title).toBe(SECRET);
    fixture.userId = 22;
    expect(await loadAnalysisRecord(ANALYSIS)).toBeNull();
  });

  it("does not expose the other user's private memory through a shared research subject", async () => {
    expect((await getMemoryFacts(11, 101)).map((fact) => fact.value)).toEqual([111]);
    expect((await getMemoryFacts(11, 202)).map((fact) => fact.value)).toEqual([222]);
    expect(await getMemoryFacts(22, 101)).toEqual([]);
    expect(await getMemoryFacts(22, 202)).toEqual([]);
  });

  it("refuses reading or appending another account's conversation", async () => {
    expect(await loadConversationHistory(CONVERSATION, 11)).toEqual([{ role: "assistant", content: SECRET }]);
    fixture.queries.length = 0;
    expect(await loadConversationHistory(CONVERSATION, 22)).toEqual([]);
    expect(fixture.queries.some((query) => query.includes("FROM hamilton_messages"))).toBe(false);
    await expect(appendMessage(CONVERSATION, 22, "user", "Injection attempt")).rejects.toThrow("Conversation not found");
  });

  it("refuses another user's upload by ID", async () => {
    expect((await getUpload(11, UPLOAD))?.preview).toEqual({ secret: SECRET });
    expect(await getUpload(22, UPLOAD)).toBeNull();
  });

  it("checks both user and historical subject when reading or adding a saved memo", async () => {
    expect((await getSavedAnalysisResponse(11, ANALYSIS, "101"))?.title).toBe(SECRET);
    expect(await getSavedAnalysisResponse(22, ANALYSIS, "101")).toBeNull();
    expect(await getSavedAnalysisResponse(11, ANALYSIS, "202")).toBeNull();
    const changed = { title: "Incorrect rewrite" } as AnalyzeResponse;
    expect(await updateSavedAnalysisResponse(22, ANALYSIS, "101", changed)).toBe(false);
    expect(await updateSavedAnalysisResponse(11, ANALYSIS, "202", changed)).toBe(false);
    expect((await getSavedAnalysisResponse(11, ANALYSIS, "101"))?.title).toBe(SECRET);
  });

  it.each(["report", "analysis"])("rejects cross-account %s PDF requests despite spoofed owner/subject fields", async (type) => {
    const body = type === "report" ? { type, reportId: REPORT } : { type, analysisId: ANALYSIS };
    expect((await exportPdf(body)).status).toBe(200);
    fixture.renderToBuffer.mockClear();
    fixture.userId = 22;
    const denied = await exportPdf({ ...body, userId: 11, institutionId: "101" });
    expect(denied.status).toBe(404);
    expect(await denied.text()).not.toContain(SECRET);
    expect(fixture.renderToBuffer).not.toHaveBeenCalled();
  });

  it("does not retain canonical home identity after membership is revoked", async () => {
    fixture.memberships.mockResolvedValueOnce([{ userId: 11, institutionId: 101, institutionName: "Synthetic Home CU", status: "active" }]);
    fixture.memberships.mockResolvedValueOnce([{ userId: 11, institutionId: 101, institutionName: "Synthetic Home CU", status: "revoked" }]);
    expect((await loadHamiltonAccountContext({ id: 11 })).institution?.id).toBe(101);
    expect(await loadHamiltonAccountContext({ id: 11 })).toMatchObject({ status: "unlinked", institution: null });
    expect(fixture.memberships.mock.calls).toEqual([[11], [11]]);
  });
});

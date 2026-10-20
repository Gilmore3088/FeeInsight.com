// @vitest-environment node
/**
 * Hamilton launch gate G2 (#1922): two accounts against one real PostgreSQL loaded from
 * tests/e2e/production-schema.sql. Account A's saved work, reports, exports, workspace context,
 * decisions, memory, uploads, peer groups, alerts, watchlist, conversations and report jobs are
 * written through the app's own code; account B (another paying bank) then tries to read, list,
 * export, change and re-use each one through the same functions, server actions and route
 * handlers a browser reaches, and is refused. Team boundaries: a viewer cannot change the team's
 * groups, a member who left keeps none of them, and an owner of one bank cannot see or manage
 * another bank's team.
 *
 * The app's own connection (`@/lib/data-store/connection`) is pointed at E2E_DATABASE_URL, which
 * must be a loopback database; anything else is refused before a query runs. Synthetic users
 * 9922001-9922004 and institutions 9922101-9922103 only; their rows are removed before and after.
 * Only the signed-in user, Next's request APIs and PDF/presign/telemetry side effects are mocked.
 * The review is docs/project/findings/2026-10-18-hamilton-customer-data-isolation-review.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const env = vi.hoisted(() => {
  const url = process.env.E2E_DATABASE_URL;
  let loopback = false;
  try {
    loopback = Boolean(url) && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url as string).hostname);
  } catch {
    loopback = false;
  }
  // The app's own client reads DATABASE_URL at import. Point it at the throwaway database, or at
  // nothing (every query throws), so this file can never reach another database.
  process.env.DATABASE_URL = loopback ? (url as string) : "";
  return { url, loopback, user: null as null | Record<string, unknown> };
});

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getCurrentUser: vi.fn(async () => env.user),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T,>(fn: T) => fn,
  unstable_noStore: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error("notFound"); },
}));
vi.mock("@/lib/analytics-server", () => ({ trackFirstHamiltonUse: vi.fn(async () => {}) }));
vi.mock("@/lib/api-hardening/route-wrapper", () => ({
  withApiRoutePolicy: (_route: string, _method: string, handler: unknown) => handler,
}));
vi.mock("@/lib/report-engine/presign", () => ({ generatePresignedUrl: vi.fn(async () => "https://example.invalid/signed") }));
vi.mock("@/lib/agents/run-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agents/run-store")>()),
  recordProRequest: vi.fn(async () => null),
}));
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: vi.fn(async () => Buffer.from("%PDF-synthetic")) }));
vi.mock("@/components/hamilton/reports/PdfDocument", () => ({ PdfDocument: () => null }));
vi.mock("@/components/hamilton/reports/AnalysisPdfDocument", () => ({ AnalysisPdfDocument: () => null }));

import { sql } from "@/lib/data-store/connection";
import {
  getSavedAnalysisResponse, insertSavedAnalysis, updateSavedAnalysisResponse,
} from "@/lib/data-store/hamilton-analyses";
import {
  createUpload, findOrOpenDecision, getDecision, getMemoryFacts, getUpload, listDecisions, saveMemoryFact,
} from "@/lib/data-store/hamilton-workspace";
import {
  deletePeerSet, getDefaultPeerSets, getSavedPeerSetById, getSavedPeerSets, savePeerSet, setDefaultPeerSet, updatePeerSet,
} from "@/lib/data-store/saved-peers";
import { addAlertSubscription, getAlertSubscriptions } from "@/lib/data-store/alerts";
import { isPurchaseLive, isReportRevoked } from "@/lib/data-store/report-payments";
import { createPurchaseReportToken, createReportToken, verifyReportToken } from "@/lib/custom-report/link";
import { reportLinkOpens } from "@/lib/custom-report/link-access";
import { getPaidReports } from "@/app/account/account-data";
import { getHamiltonReportById, getHamiltonScenarioById, getRecentHamiltonReports, saveHamiltonReport } from "./pro-tables";
import { appendMessage, createConversation, listConversations, loadConversationHistory } from "./chat-memory";
import { getHamiltonWorkspaceContext, resolveHamiltonInstitutionContext, setHamiltonWorkspaceContext } from "./workspace-context";
import { getActiveInstitutionMembership, getUserInstitutionMemberships, revokeInstitutionWorkspaceMembership } from "./institution-membership";
import { fetchMonitorPageData } from "./monitor-data";
import { applyUpload } from "./uploads/service";
import { makeDeliverable } from "./decision-service";
import { loadAnalysisRecord, listSavedAnalyses } from "@/app/pro/(hamilton)/analyze/actions";
import { loadReport, loadScenarioById } from "@/app/pro/(hamilton)/reports/actions";
import { saveBoardBrief } from "@/app/pro/(hamilton)/reports/board-actions";
import { listScenarios } from "@/app/pro/(hamilton)/simulate/actions";
import { removeFromWatchlist } from "@/app/pro/(hamilton)/monitor/actions";
import { createPeerSet, grantWorkspaceAccess, revokeWorkspaceAccess, revokeWorkspaceInvitation } from "@/app/pro/(hamilton)/settings/actions";
import { POST as reportPdf } from "@/app/api/pro/report-pdf/route";
import { GET as reportStatus } from "@/app/api/reports/[id]/status/route";
import { GET as reportDownload } from "@/app/api/reports/[id]/download/route";
import { DELETE as alertsDelete, GET as alertsGet } from "@/app/api/alerts/route";
import { GET as conversationMessages } from "@/app/api/hamilton/conversations/[id]/messages/route";
import type { AnalyzeResponse } from "./types";
import type { ReportSummaryResponse } from "./types";

const A = 9922001; // owner of bank X
const B = 9922002; // owner of bank Y: the other paying account
const C = 9922003; // viewer on bank X's team
const D = 9922004; // was an analyst on bank X's team, now removed
const USERS = [A, B, C, D];
const X = 9922101;
const Y = 9922102;
const Z = 9922103; // a bank nobody bought a report for
const INSTITUTIONS = [X, Y, Z];
const MIGRATIONS = [
  "20270108000001_hamilton_decision_workspace.sql",
  "20270110000003_lead_report_payment.sql",
  "20270110000021_saved_peer_sets_custom_peers.sql",
  "20270110000039_lead_report_refund.sql",
];
const ALERT_FUNCTIONS = "20260813062152_physical_institution_data_contracts.sql";

function as(id: number, role = "premium") {
  // The signed-in user as getCurrentUser returns it: a numeric id (auth.ts userFromRow).
  env.user = {
    id, role, username: `iso${id}@example.test`, email: `iso${id}@example.test`, display_name: `Isolation ${id}`,
    subscription_status: role === "premium" ? "active" : "none", stripe_customer_id: null, institution_name: null,
    workspace_seat: false, is_active: true,
  };
}

const response = (lead: string) => ({ title: lead, summary: lead, sections: [] }) as unknown as AnalyzeResponse;
const req = (url: string, init?: RequestInit) => new NextRequest(new URL(url, "http://localhost"), init as never);
const params = <T,>(value: T) => ({ params: Promise.resolve(value) });
const form = (fields: Record<string, string | number>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, String(value));
  return data;
};

describe.skipIf(!env.url)("Hamilton customer data isolation in isolated PostgreSQL (#1922)", () => {
  let db: ReturnType<typeof postgres>;
  const ids = {} as Record<string, string>;
  const peer = {} as Record<string, number>;
  const membership = {} as Record<string, number>;
  let invitationX = 0;

  const cleanup = async () => {
    const users = USERS.map(String);
    const insts = INSTITUTIONS.map(String);
    for (const table of ["hamilton_saved_analyses", "hamilton_reports", "hamilton_scenarios", "hamilton_watchlists", "hamilton_priority_alerts"]) {
      await db.unsafe(`DELETE FROM ${table} WHERE user_id = ANY($1::text[])`, [users]);
    }
    await db`DELETE FROM hamilton_signals WHERE institution_id = ANY(${insts}::text[])`;
    await db`DELETE FROM hamilton_messages WHERE conversation_id IN (SELECT id FROM hamilton_conversations WHERE user_id::text = ANY(${users}::text[]))`;
    await db`DELETE FROM hamilton_conversations WHERE user_id::text = ANY(${users}::text[])`;
    await db`DELETE FROM hamilton_decision_events WHERE decision_id IN (SELECT id FROM hamilton_decisions WHERE user_id::text = ANY(${users}::text[]))`;
    for (const table of ["hamilton_decisions", "hamilton_institution_memory", "hamilton_uploads", "institution_fee_alert_subscriptions", "report_jobs", "hamilton_workspace_contexts"]) {
      await db.unsafe(`DELETE FROM ${table} WHERE user_id::text = ANY($1::text[])`, [users]);
    }
    await db`DELETE FROM saved_peer_sets WHERE created_by = ANY(${users}::text[]) OR institution_id = ANY(${INSTITUTIONS}::int[])`;
    await db`DELETE FROM institution_workspace_invitations WHERE institution_id = ANY(${INSTITUTIONS}::bigint[])`;
    await db`DELETE FROM institution_workspace_memberships WHERE institution_id = ANY(${INSTITUTIONS}::bigint[]) OR user_id = ANY(${USERS}::bigint[])`;
    await db`DELETE FROM leads WHERE email LIKE 'iso99220%@example.test'`;
    await db`DELETE FROM users WHERE id = ANY(${USERS}::bigint[])`;
    await db`DELETE FROM institution_sources WHERE id = ANY(${INSTITUTIONS}::bigint[])`;
  };

  beforeAll(async () => {
    if (!env.loopback) throw new Error("Customer isolation tests require a loopback E2E database; production connections are forbidden");
    vi.stubEnv("BFI_COOKIE_SECRET", "synthetic-invite-secret-for-isolation-tests");
    vi.stubEnv("CUSTOM_REPORT_LINK_SECRET", "synthetic-report-link-secret");
    db = postgres(env.url as string, { max: 1, ssl: "require", onnotice: () => {} });
    const migration = (file: string) => readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8");
    for (const file of MIGRATIONS) await db.unsafe(migration(file));
    // The alert upsert/deactivate functions only, from the migration that defines them.
    const contracts = migration(ALERT_FUNCTIONS);
    await db.unsafe(contracts.slice(
      contracts.indexOf("CREATE OR REPLACE FUNCTION public.upsert_institution_fee_alert_subscription"),
      contracts.indexOf("REVOKE ALL ON FUNCTION public.upsert_institution_fee_alert_subscription"),
    ));
    await cleanup();
    for (const [id, name] of [[X, "Synthetic Isolation Bank X"], [Y, "Synthetic Isolation Bank Y"], [Z, "Synthetic Isolation Bank Z"]] as const) {
      await db`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code, city)
               VALUES (${id}, ${name}, 'bank', 'synthetic', 'KS', 'Testville')`;
    }
    for (const id of USERS) {
      await db`INSERT INTO users (id, username, password_hash, display_name, role, email, subscription_status, is_active)
               VALUES (${id}, ${`iso${id}@example.test`}, 'x', ${`Isolation ${id}`}, 'premium', ${`iso${id}@example.test`}, 'active', true)`;
    }
    const grant = async (user: number, inst: number, role: string, status = "active") => {
      const [row] = await db`INSERT INTO institution_workspace_memberships (institution_id, user_id, membership_role, membership_status, source, granted_at)
                             VALUES (${inst}, ${user}, ${role}, ${status}, 'manual_admin', NOW()) RETURNING id`;
      return Number(row.id);
    };
    membership.aX = await grant(A, X, "owner");
    membership.bY = await grant(B, Y, "owner");
    membership.cX = await grant(C, X, "viewer");
    membership.dX = await grant(D, X, "analyst");
    const [invite] = await db`INSERT INTO institution_workspace_invitations (institution_id, email, invited_role, invitation_status, invited_by_user_id, expires_at)
                              VALUES (${X}, 'new-hire@bank-x.example.test', 'analyst', 'pending', ${A}, NOW() + interval '7 days') RETURNING id`;
    invitationX = Number(invite.id);

    // Account A's work, written through the app's own code.
    as(A);
    await setHamiltonWorkspaceContext({ userId: A, institutionId: X, source: "manual" });
    ids.analysis = (await insertSavedAnalysis({
      userId: A, institutionId: String(X), title: "A's overdraft answer", analysisFocus: "pricing",
      prompt: "What is our overdraft fee against peers?", response: response("Bank X secret: overdraft $35"),
      replaceRecentDuplicate: { request: "storyline\n\n\n\nWhat is our overdraft fee against peers?" },
    })) as string;
    ids.report = await saveHamiltonReport({
      userId: A, institutionId: String(X), reportType: "board_brief",
      reportJson: { title: "A's board brief", boardBrief: { title: "A's board brief", teamNote: "Bank X only" } } as unknown as ReportSummaryResponse,
    });
    const [scenario] = await db`INSERT INTO hamilton_scenarios (user_id, institution_id, fee_category, current_value, proposed_value, result_json, confidence_tier, status)
                                VALUES (${String(A)}, ${String(X)}, 'overdraft', 35, 29, '{}'::jsonb, 'strong', 'active') RETURNING id::text`;
    ids.scenario = scenario.id;
    ids.conversation = await createConversation(A);
    await appendMessage(ids.conversation, A, "user", "Bank X private question");
    ids.decision = (await findOrOpenDecision({ userId: A, institutionId: X, feeCategory: "overdraft", title: "Overdraft review", actor: `user:${A}` })).decision.id;
    await saveMemoryFact({ userId: A, institutionId: X, fieldKey: "income.overdraft", value: 1250000, givenBy: "A", source: "answer" });
    ids.upload = (await createUpload({
      userId: A, institutionId: X, fileName: "bank-x-fee-income.csv", contentType: "text/csv", byteSize: 10,
      preview: { rowsRead: 1, fees: [{ feeCategory: "overdraft", income: 1250000 }], unmatched: [] }, status: "mapped",
    })).id;
    await addAlertSubscription(A, X, null);
    await db`INSERT INTO hamilton_watchlists (user_id, institution_ids) VALUES (${String(A)}, ${db.json([String(X)])})`;
    const [signal] = await db`INSERT INTO hamilton_signals (institution_id, signal_type, severity, title, body)
                              VALUES (${String(X)}, 'fee_change', 'high', 'Bank X private alert', 'Only A follows this') RETURNING id`;
    await db`INSERT INTO hamilton_priority_alerts (user_id, signal_id, status) VALUES (${String(A)}, ${signal.id}, 'active')`;
    const [job] = await db`INSERT INTO report_jobs (report_type, status, params, user_id, artifact_key, completed_at)
                           VALUES ('peer_brief', 'complete', '{}'::jsonb, ${A}, 'reports/bank-x-private.pdf', NOW()) RETURNING id::text`;
    ids.job = job.id;
    peer.personalA = await savePeerSet("A's private cohort", { states: ["KS"] }, String(A), null);
    peer.teamX = await savePeerSet("Bank X team cohort", { states: ["KS", "MO"] }, String(A), X);
    peer.teamXByD = await savePeerSet("Cohort D wrote for X", { states: ["NE"] }, String(D), X);
    await setDefaultPeerSet({ id: peer.teamX, userId: String(A), institutionId: null });
    // D leaves bank X's team after writing a team group.
    expect(await revokeInstitutionWorkspaceMembership({ membershipId: membership.dX, revokedByUserId: A })).not.toBeNull();
  });

  beforeEach(() => as(B));
  afterAll(async () => {
    env.user = null;
    if (db) {
      await cleanup();
      await db.end();
    }
    await sql.end({ timeout: 1 }).catch(() => {});
    vi.unstubAllEnvs();
  });

  describe("saved analyses and the Ask repeat cache", () => {
    it("B cannot open, list, read, overwrite or export A's saved answer", async () => {
      expect(await loadAnalysisRecord(ids.analysis)).toBeNull();
      expect((await listSavedAnalyses(50)).map((row) => row.id)).not.toContain(ids.analysis);
      expect(await getSavedAnalysisResponse(B, ids.analysis, String(X))).toBeNull();
      expect(await updateSavedAnalysisResponse(B, ids.analysis, String(X), response("written by B"))).toBe(false);
      const pdf = await reportPdf(req("/api/pro/report-pdf", { method: "POST", body: JSON.stringify({ type: "analysis", analysisId: ids.analysis }) }));
      expect(pdf.status).toBe(404);
      as(A);
      expect((await loadAnalysisRecord(ids.analysis))?.responseJson.title).toBe("Bank X secret: overdraft $35");
    });

    it("the same question from B files B's own row and never returns or rewrites A's cached answer", async () => {
      const mine = await insertSavedAnalysis({
        userId: B, institutionId: String(X), title: "B's answer", analysisFocus: "pricing",
        prompt: "What is our overdraft fee against peers?", response: response("B's answer"),
        replaceRecentDuplicate: { request: "storyline\n\n\n\nWhat is our overdraft fee against peers?" },
      });
      expect(mine).toBeTruthy();
      expect(mine).not.toBe(ids.analysis);
      const [row] = await db`SELECT user_id, response_json->>'title' AS title FROM hamilton_saved_analyses WHERE id = ${ids.analysis}`;
      expect(row).toEqual({ user_id: String(A), title: "Bank X secret: overdraft $35" });
    });
  });

  describe("reports and exports", () => {
    it("B cannot open, list, edit or export A's report", async () => {
      expect(await getHamiltonReportById(ids.report, B)).toBeNull();
      expect((await getRecentHamiltonReports(B)).map((r) => r.id)).not.toContain(ids.report);
      expect(await loadReport(ids.report)).toBeNull();
      const edit = await saveBoardBrief({ reportId: ids.report, edits: { title: "Hijacked", teamNote: "B was here", includeEvidence: false } as never });
      expect(edit).toEqual({ success: false, error: "Editable board brief not found." });
      const pdf = await reportPdf(req("/api/pro/report-pdf", { method: "POST", body: JSON.stringify({ reportId: ids.report }) }));
      expect(pdf.status).toBe(404);
      const [row] = await db`SELECT report_json->>'title' AS title FROM hamilton_reports WHERE id = ${ids.report}`;
      expect(row.title).toBe("A's board brief");
      expect((await getHamiltonReportById(ids.report, A))?.id).toBe(ids.report);
    });

    it("B gets 403 for A's report job status and download (no signed URL)", async () => {
      const status = await reportStatus(req(`/api/reports/${ids.job}/status`), params({ id: ids.job }));
      expect(status.status).toBe(403);
      const download = await reportDownload(req(`/api/reports/${ids.job}/download`), params({ id: ids.job }));
      expect(download.status).toBe(403);
      as(A);
      const own = await reportStatus(req(`/api/reports/${ids.job}/status`), params({ id: ids.job }));
      expect(own.status).toBe(200);
      expect((await own.json()).presigned_url).toBe("https://example.invalid/signed");
    });
  });

  describe("scenarios", () => {
    it("B cannot open or list A's scenario", async () => {
      expect(await getHamiltonScenarioById(ids.scenario, B)).toBeNull();
      expect(await loadScenarioById(ids.scenario)).toBeNull();
      expect((await listScenarios(50)).map((s) => s.id)).not.toContain(ids.scenario);
      expect((await getHamiltonScenarioById(ids.scenario, A))?.id).toBe(ids.scenario);
    });
  });

  describe("conversations", () => {
    it("B cannot list, read or append to A's conversation", async () => {
      expect((await listConversations(B)).map((c) => c.id)).not.toContain(ids.conversation);
      expect(await loadConversationHistory(ids.conversation, B)).toEqual([]);
      await expect(appendMessage(ids.conversation, B, "user", "B's injected message")).rejects.toThrow("Conversation not found");
      const [{ n }] = await db`SELECT count(*)::int AS n FROM hamilton_messages WHERE conversation_id = ${ids.conversation}`;
      expect(n).toBe(1);
      as(B, "analyst");
      const route = await conversationMessages(req(`/api/hamilton/conversations/${ids.conversation}/messages`), params({ id: ids.conversation }));
      expect(await route.json()).toEqual({ messages: [] });
    });
  });

  describe("workspace context, decisions, memory and uploads", () => {
    it("B does not inherit A's saved bank", async () => {
      expect(await getHamiltonWorkspaceContext(B)).toBeNull();
      expect((await resolveHamiltonInstitutionContext({ userId: B })).institution).toBeNull();
      expect((await getHamiltonWorkspaceContext(A))?.selectedInstitutionId).toBe(X);
    });

    it("researching the same bank, B sees none of A's decisions, figures or uploads", async () => {
      expect(await getDecision(B, ids.decision)).toBeNull();
      expect(await listDecisions(B, X)).toEqual([]);
      expect(await getMemoryFacts(B, X)).toEqual([]);
      expect(await getUpload(B, ids.upload)).toBeNull();
      expect((await applyUpload({ id: B }, { uploadId: ids.upload })).status).toBe(404);
      expect((await makeDeliverable({ id: B }, "board_memo", [ids.decision])).status).toBe(404);
      const [upload] = await db`SELECT status FROM hamilton_uploads WHERE id = ${ids.upload}`;
      expect(upload.status).toBe("mapped");
      expect((await getMemoryFacts(A, X)).map((f) => f.fieldKey)).toEqual(["income.overdraft"]);
      // A lone number is stored as a number, not the JSON string "1250000" (#2004).
      expect((await getMemoryFacts(A, X)).map((f) => f.value)).toEqual([1250000]);
      const [stored] = await db`SELECT jsonb_typeof(value) AS kind FROM hamilton_institution_memory WHERE user_id = ${A} AND institution_id = ${X} AND superseded_at IS NULL`;
      expect(stored.kind).toBe("number");
      expect((await listDecisions(A, X)).map((d) => d.id)).toEqual([ids.decision]);
    });
  });

  describe("alerts and monitoring", () => {
    it("B cannot list or remove A's fee alert", async () => {
      const list = await alertsGet();
      expect((await list.json()).subscriptions).toEqual([]);
      const removed = await alertsDelete(req(`/api/alerts?institution_id=${X}`, { method: "DELETE" }));
      expect(removed.status).toBe(404);
      expect((await getAlertSubscriptions(A)).map((s) => Number(s.institution_id))).toEqual([X]);
    });

    it("B's Monitor shows none of A's watchlist or priority alerts, and B's edits leave A's list alone", async () => {
      const monitor = await fetchMonitorPageData(B);
      expect(monitor.watchlist).toEqual([]);
      expect(monitor.topAlert).toBeNull();
      expect(monitor.status.highPriorityAlerts).toBe(0);
      const scoped = await fetchMonitorPageData(B, { selectedInstitutionId: X });
      expect(scoped.topAlert).toBeNull();
      expect(scoped.status.highPriorityAlerts).toBe(0);
      expect((await removeFromWatchlist(String(X))).ok).toBe(true);
      const [row] = await db`SELECT institution_ids FROM hamilton_watchlists WHERE user_id = ${String(A)}`;
      expect(row.institution_ids).toEqual([String(X)]);
      expect((await fetchMonitorPageData(A)).topAlert?.title).toBeTruthy();
    });
  });

  describe("peer groups and team boundaries", () => {
    it("another bank's owner sees, uses and changes none of A's personal or team groups", async () => {
      const visible = (await getSavedPeerSets(String(B), X)).map((s) => s.id);
      expect(visible).not.toContain(peer.personalA);
      expect(visible).not.toContain(peer.teamX);
      expect(await getSavedPeerSetById(peer.teamX, String(B))).toBeNull();
      expect(await getSavedPeerSetById(peer.personalA, String(B))).toBeNull();
      expect(await getDefaultPeerSets({ userId: String(B), institutionId: X })).toEqual([]);
      expect(await updatePeerSet(peer.teamX, "Renamed by B", {}, String(B))).toBe(false);
      expect(await setDefaultPeerSet({ id: peer.teamX, userId: String(B), institutionId: null })).toBeNull();
      expect(await deletePeerSet(peer.teamX, String(B))).toBe(false);
      expect(await deletePeerSet(peer.personalA, String(B))).toBe(false);
    });

    it("a group B saves comes back to B (numeric id) and stays B's alone", async () => {
      const made = await createPeerSet(form({ name: "B's own cohort", research_institution_id: "", states: "MO" }));
      expect(made.success).toBe(true);
      // The id arrives from a bigint column; the saved set must still be found and returned.
      expect(typeof made.id).toBe("number");
      expect(made.peerSet?.id).toBe(made.id);
      expect(made.peerSet?.institution_id).toBeNull();
      expect((await getSavedPeerSets(String(A), X)).map((s) => s.id)).not.toContain(made.id);
      expect((await getSavedPeerSets(String(C), X)).map((s) => s.id)).not.toContain(made.id);
    });

    it("a viewer on A's team uses the team group but cannot change it, and never sees A's personal group", async () => {
      const visible = (await getSavedPeerSets(String(C), X)).map((s) => s.id);
      expect(visible).toContain(peer.teamX);
      expect(visible).not.toContain(peer.personalA);
      expect((await getDefaultPeerSets({ userId: String(C), institutionId: X })).map((s) => s.id)).toEqual([peer.teamX]);
      expect(await updatePeerSet(peer.teamX, "Renamed by viewer", {}, String(C))).toBe(false);
      expect(await deletePeerSet(peer.teamX, String(C))).toBe(false);
    });

    it("a member who left the team keeps none of its groups, even one they wrote", async () => {
      expect((await getSavedPeerSets(String(D), X)).map((s) => s.id)).toEqual([]);
      expect((await getSavedPeerSets(String(D), null)).map((s) => s.id)).toEqual([]);
      expect(await getSavedPeerSetById(peer.teamXByD, String(D))).toBeNull();
      expect(await updatePeerSet(peer.teamXByD, "Renamed after leaving", {}, String(D))).toBe(false);
      expect(await deletePeerSet(peer.teamXByD, String(D))).toBe(false);
      // The team still has it.
      expect((await getSavedPeerSets(String(A), X)).map((s) => s.id)).toEqual(expect.arrayContaining([peer.teamX, peer.teamXByD, peer.personalA]));
    });

    it("B has no membership of bank X and cannot invite to, remove from or cancel invites on X's team", async () => {
      expect(await getActiveInstitutionMembership({ userId: B, institutionId: X })).toBeNull();
      expect((await getUserInstitutionMemberships(B)).map((m) => m.institutionId)).toEqual([Y]);
      const invite = await grantWorkspaceAccess({ success: false }, form({ institution_id: X, email: "b-plant@bank-y.example.test", role: "admin" }));
      expect(invite).toEqual({ success: false, error: "Only institution owners or admins can manage workspace access." });
      const removeOnX = await revokeWorkspaceAccess({ success: false }, form({ institution_id: X, membership_id: membership.cX }));
      expect(removeOnX).toEqual({ success: false, error: "Only institution owners or admins can revoke workspace access." });
      // Naming B's own bank does not reach a membership of another bank.
      const removeViaY = await revokeWorkspaceAccess({ success: false }, form({ institution_id: Y, membership_id: membership.cX }));
      expect(removeViaY).toEqual({ success: false, error: "Active workspace membership not found." });
      const cancelOnX = await revokeWorkspaceInvitation({ success: false }, form({ institution_id: X, invitation_id: invitationX }));
      expect(cancelOnX).toEqual({ success: false, error: "Only institution owners or admins can revoke workspace invitations." });
      const cancelViaY = await revokeWorkspaceInvitation({ success: false }, form({ institution_id: Y, invitation_id: invitationX }));
      expect(cancelViaY).toEqual({ success: false, error: "Pending workspace invitation not found." });
      const [c] = await db`SELECT membership_status FROM institution_workspace_memberships WHERE id = ${membership.cX}`;
      expect(c.membership_status).toBe("active");
      const [inv] = await db`SELECT invitation_status FROM institution_workspace_invitations WHERE id = ${invitationX}`;
      expect(inv.invitation_status).toBe("pending");
      const [{ n }] = await db`SELECT count(*)::int AS n FROM institution_workspace_invitations WHERE institution_id = ${X}`;
      expect(n).toBe(1);
    });
  });

  describe("paid market-report links", () => {
    it("lists a paid report only for the buyer's own email", async () => {
      await db`INSERT INTO leads (name, email, source, quote_institution_id, quote_amount_cents, paid_at)
               VALUES ('Buyer A', ${`iso${A}@example.test`}, 'report', ${X}, 30000, NOW())`;
      expect((await getPaidReports(`iso${A}@example.test`)).map((r) => r.institutionName)).toEqual(["Synthetic Isolation Bank X"]);
      expect(await getPaidReports(`iso${B}@example.test`)).toEqual([]);
    });

    it("closes a refunded legacy bank link, but keeps it open while another buyer of the same bank has paid (it names the bank, not the buyer)", async () => {
      await db`DELETE FROM leads WHERE email LIKE 'iso99220%@example.test'`;
      const [first] = await db`INSERT INTO leads (name, email, source, quote_institution_id, quote_amount_cents, paid_at, refunded_at)
                               VALUES ('Buyer A', ${`iso${A}@example.test`}, 'report', ${X}, 30000, NOW(), NOW()) RETURNING id`;
      expect(await isReportRevoked(X)).toBe(true);
      await db`INSERT INTO leads (name, email, source, quote_institution_id, quote_amount_cents, paid_at)
               VALUES ('Buyer B', ${`iso${B}@example.test`}, 'report', ${X}, 30000, NOW())`;
      expect(await isReportRevoked(X)).toBe(false);
      // The refunded buyer's own copy of the link is the same token, so it opens again.
      const token = createReportToken(X) as string;
      expect(verifyReportToken(token)?.institutionId).toBe(X);
      expect(await getPaidReports(`iso${A}@example.test`)).toEqual([]);
      await db`DELETE FROM leads WHERE id = ${first.id}`;
    });

    it("closes a refunded buyer's purchase link even while another buyer of the same bank has paid (#2000)", async () => {
      await db`DELETE FROM leads WHERE email LIKE 'iso99220%@example.test'`;
      const [refunded] = await db`INSERT INTO leads (name, email, source, quote_institution_id, quote_amount_cents, paid_at, refunded_at)
                                  VALUES ('Buyer A', ${`iso${A}@example.test`}, 'report', ${X}, 30000, NOW(), NOW()) RETURNING id`;
      const [live] = await db`INSERT INTO leads (name, email, source, quote_institution_id, quote_amount_cents, paid_at)
                              VALUES ('Buyer B', ${`iso${B}@example.test`}, 'report', ${X}, 30000, NOW()) RETURNING id`;
      const refundedLink = verifyReportToken(createPurchaseReportToken(X, Number(refunded.id)) as string);
      const liveLink = verifyReportToken(createPurchaseReportToken(X, Number(live.id)) as string);
      expect(refundedLink && (await reportLinkOpens(refundedLink))).toBe(false);
      expect(liveLink && (await reportLinkOpens(liveLink))).toBe(true);
      // A live payment for one bank does not open a link signed for another bank.
      expect(await isPurchaseLive(Number(live.id), Y)).toBe(false);
      // The account page lists the live buyer's purchase link only.
      const [listed] = await getPaidReports(`iso${B}@example.test`);
      expect(listed.href).toContain(`-p${live.id}-`);
      expect(await getPaidReports(`iso${A}@example.test`)).toEqual([]);
      await db`DELETE FROM leads WHERE id IN (${refunded.id}, ${live.id})`;
    });

    it("is not tied to a Pro subscription: cancelling one leaves a paid link open until it expires", async () => {
      await db`UPDATE users SET subscription_status = 'canceled' WHERE id = ${A}`;
      expect(await isReportRevoked(X)).toBe(false);
      expect(verifyReportToken(createReportToken(X) as string)).not.toBeNull();
      // A bank nobody paid for: no lead row, so nothing marks it revoked.
      expect(await isReportRevoked(Z)).toBe(false);
      await db`UPDATE users SET subscription_status = 'active' WHERE id = ${A}`;
    });
  });
});

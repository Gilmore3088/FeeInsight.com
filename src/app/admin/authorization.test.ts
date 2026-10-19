import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission, User } from "@/lib/auth";

const fixture = vi.hoisted(() => ({
  user: null as User | null,
  dataRead: vi.fn(),
  requireAuth: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getCurrentUser: fixture.getCurrentUser,
    requireAuth: fixture.requireAuth.mockImplementation(async (permission?: Permission) => {
      if (!fixture.user || (permission && !actual.hasPermission(fixture.user, permission))) {
        throw new Error("operator access denied");
      }
      return fixture.user;
    }),
  };
});
vi.mock("@/lib/data-store/connection", () => ({
  sql: fixture.dataRead,
  getSql: fixture.dataRead,
}));
vi.mock("@/lib/admin-queries", () => ({
  getDataTrustQueueRows: fixture.dataRead,
  getInstitutionClaimCounts: fixture.dataRead,
  getSourceSubmissionCounts: fixture.dataRead,
  listInstitutionClaims: fixture.dataRead,
  listSourceSubmissions: fixture.dataRead,
}));
vi.mock("@/lib/automation-control", () => ({ getAutomationControl: fixture.dataRead }));
vi.mock("@/lib/data-store/agent-console", () => ({
  listRecentThreads: fixture.dataRead,
  getLineageGraph: fixture.dataRead,
  listRecentPublishedFees: fixture.dataRead,
  getReasoningTrace: fixture.dataRead,
}));
vi.mock("@/lib/agents/flow", () => ({
  getFlowSnapshot: fixture.dataRead,
  getFlowWaitingWithin: fixture.dataRead,
}));
vi.mock("@/lib/data-store/content-drafts", () => ({ getContentDraft: fixture.dataRead }));
vi.mock("@/lib/data-store/guides", () => ({
  getGuideBySlug: fixture.dataRead, approveGuideRegulatoryContent: vi.fn(),
  publishGuide: vi.fn(), setGuideStatus: vi.fn(),
}));
vi.mock("@/lib/agents/content/cards", () => ({ depthCard: vi.fn(), spreadCard: vi.fn() }));
vi.mock("@/lib/api-hardening/route-wrapper", () => ({
  withApiRoutePolicy: (_route: string, _method: string, handler: unknown) => handler,
}));
vi.mock("./quality/actions", () => ({
  acceptSourceSubmission: vi.fn(), acceptInstitutionClaim: vi.fn(),
  rejectSourceSubmission: vi.fn(), rejectInstitutionClaim: vi.fn(),
  requestInstitutionClaimInfo: vi.fn(), requestSourceSubmissionInfo: vi.fn(),
}));
vi.mock("./hamilton/report-controls", () => ({ ReportControls: () => null }));
vi.mock("./hamilton/actions", () => ({ cancelAllPending: vi.fn() }));
vi.mock("./hamilton/reports/reports-table", () => ({ ReportsTable: () => null }));
vi.mock("./agents/lineage/recent-picker", () => ({ RecentPicker: () => null }));
vi.mock("./agents/lineage/tree-view", () => ({ TreeView: () => null }));
vi.mock("./agents/replay/timeline", () => ({ Timeline: () => null }));
vi.mock("./room-hub", () => ({ ScreenHeader: () => null }));

import QualityPage from "./quality/page";
import ReportsPage from "./hamilton/reports/page";
import MessagesPage from "./agents/messages/page";
import LineagePage from "./agents/lineage/page";
import ReplayPage from "./agents/replay/page";
import { loadGuideForPreviewAction } from "./hamilton/guides/actions";
import { GET as getFlow } from "@/app/api/admin/flow/route";
import { GET as getCard } from "@/app/api/admin/content/card/[id]/route";

const pages = [
  ["quality", () => QualityPage({ searchParams: Promise.resolve({}) })],
  ["reports", () => ReportsPage({ searchParams: Promise.resolve({}) })],
  ["messages", () => MessagesPage()],
  ["lineage", () => LineagePage({ searchParams: Promise.resolve({}) })],
  ["replay", () => ReplayPage({ searchParams: Promise.resolve({ correlation: "11111111-1111-4111-8111-111111111111" }) })],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  fixture.user = null;
  fixture.getCurrentUser.mockImplementation(async () => fixture.user);
  fixture.dataRead.mockResolvedValue(null);
});

function user(role: User["role"]): User {
  return { id: 7, role, username: "synthetic-operator" } as User;
}

describe("admin reads enforce their own operator boundary", () => {
  it.each(pages)("%s denies signed-out, free and Pro callers before reading data", async (_name, run) => {
    for (const identity of [null, user("viewer"), user("premium")]) {
      fixture.user = identity;
      await expect(run()).rejects.toThrow("operator access denied");
      expect(fixture.requireAuth).toHaveBeenLastCalledWith("operate");
      expect(fixture.dataRead).not.toHaveBeenCalled();
    }
  });

  it.each(["analyst", "admin"] as const)("allows a legitimate %s to read messages", async (role) => {
    fixture.user = user(role);
    fixture.dataRead.mockResolvedValue([]);
    await expect(MessagesPage()).resolves.toBeTruthy();
    expect(fixture.dataRead).toHaveBeenCalledWith(72, 50);
  });

  it("denies direct unpublished-guide preview actions for public accounts", async () => {
    for (const identity of [null, user("viewer"), user("premium")]) {
      fixture.user = identity;
      await expect(loadGuideForPreviewAction("synthetic-unpublished-guide")).rejects.toThrow("operator access denied");
      expect(fixture.dataRead).not.toHaveBeenCalled();
    }
    fixture.user = user("analyst");
    fixture.dataRead.mockResolvedValue({ title: "Synthetic unpublished guide" });
    await expect(loadGuideForPreviewAction("synthetic-unpublished-guide")).resolves.toEqual({ title: "Synthetic unpublished guide" });
    expect(fixture.dataRead).toHaveBeenCalledWith("synthetic-unpublished-guide", { includeUnpublished: true });
  });

  it("denies direct flow and draft-card requests before their data reads", async () => {
    for (const identity of [null, user("viewer"), user("premium")]) {
      fixture.user = identity;
      expect((await getFlow()).status).toBe(401);
      const request = new NextRequest("http://localhost/api/admin/content/card/1");
      expect((await getCard(request, { params: Promise.resolve({ id: "1" }) })).status).toBe(401);
      expect(fixture.dataRead).not.toHaveBeenCalled();
    }
  });

  it.each(["analyst", "admin"] as const)("allows a legitimate %s to request flow and draft cards", async (role) => {
    fixture.user = user(role);
    fixture.dataRead.mockResolvedValue({ moves: [] });
    expect((await getFlow()).status).toBe(200);
    fixture.dataRead.mockResolvedValue(null);
    const request = new NextRequest("http://localhost/api/admin/content/card/1");
    // Operator auth succeeds; the synthetic draft deliberately does not exist.
    expect((await getCard(request, { params: Promise.resolve({ id: "1" }) })).status).toBe(404);
    expect(fixture.dataRead).toHaveBeenCalledWith(1);
  });
});

function pageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? pageFiles(file) : entry.name === "page.tsx" ? [file] : [];
  });
}

// Redirects disclose no data; their destination's page still must own its guard.
const redirectOnly = new Set([
  "login/page.tsx", "hamilton/page.tsx", "hamilton/scout/page.tsx", "scout/page.tsx",
  "research/page.tsx", "research/articles/page.tsx", "research/usage/page.tsx", "research/[agentId]/page.tsx",
  // Duplicate screens retired in #1122: two of the fee catalog, one of the Growth page.
  "index/page.tsx", "peers/page.tsx", "agents/marketing/page.tsx",
]);

describe("admin page authorization inventory", () => {
  it("keeps an operator-only guard as the first awaited work of every data page", () => {
    const directory = path.join(process.cwd(), "src/app/admin");
    const approved = new Set(["operate", "manage_users", "edit", "approve", "trigger_jobs"]);
    for (const file of pageFiles(directory)) {
      const relative = path.relative(directory, file);
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      if (redirectOnly.has(relative)) {
        expect(source.text, relative).toMatch(/\b(?:permanentRedirect|redirect)\(/);
        continue;
      }
      const page = source.statements.find((node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) && Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)),
      );
      expect(page?.body, relative).toBeDefined();
      let firstAwait: ts.AwaitExpression | undefined;
      const visit = (node: ts.Node): void => {
        if (firstAwait) return;
        if (ts.isAwaitExpression(node)) firstAwait = node;
        else ts.forEachChild(node, visit);
      };
      visit(page!.body!);
      const call = firstAwait?.expression;
      expect(call && ts.isCallExpression(call) && call.expression.getText(source), relative).toBe("requireAuth");
      const permission = call && ts.isCallExpression(call) ? call.arguments[0] : undefined;
      expect(permission && ts.isStringLiteral(permission) && approved.has(permission.text), relative).toBe(true);
    }
  });
});

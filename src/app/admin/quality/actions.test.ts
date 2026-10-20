import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuth = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: (permission: string) => requireAuth(permission) }));
vi.mock("@/lib/admin-queries", () => ({ clearSourceSubmissionCountsCache: vi.fn() }));
vi.mock("@/lib/automation-control", () => ({ getAutomationControl: vi.fn(() => Promise.resolve({ enabled: true })) }));
const { sqlMock, withTransaction, addHandFoundLink } = vi.hoisted(() => ({
  sqlMock: Object.assign(vi.fn(), { json: (value: unknown) => value }),
  withTransaction: vi.fn(),
  addHandFoundLink: vi.fn(),
}));
vi.mock("@/lib/data-store/connection", () => ({ sql: sqlMock, withTransaction: (fn: unknown) => withTransaction(fn) }));
vi.mock("@/lib/agents/magellan/operator-schedules", () => ({ addHandFoundLink: (options: unknown) => addHandFoundLink(options) }));
vi.mock("@/lib/hamilton/institution-membership", () => ({ grantInstitutionWorkspaceMembership: vi.fn() }));
vi.mock("@/lib/hamilton/monitor-signals", () => ({ recordHamiltonMonitorSignal: vi.fn() }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ setHamiltonWorkspaceContext: vi.fn() }));

import * as actions from "./actions";

// Outside submissions reach the pipeline or a workspace only after an admin reviews them (2026-10-16).
describe("submission and claim review", () => {
  beforeEach(() => {
    requireAuth.mockReset();
    requireAuth.mockRejectedValue(new Error("stop after the auth check"));
  });

  const reviewActions = [
    "acceptSourceSubmission",
    "rejectSourceSubmission",
    "requestSourceSubmissionInfo",
    "acceptInstitutionClaim",
    "rejectInstitutionClaim",
    "requestInstitutionClaimInfo",
  ] as const;

  it.each(reviewActions)("%s needs the admin-only edit permission", async (name) => {
    const form = new FormData();
    form.set("submission_id", "1");
    form.set("claim_id", "1");
    await expect(actions[name](form)).rejects.toThrow("stop after the auth check");
    expect(requireAuth).toHaveBeenCalledWith("edit");
  });
});

// #1038: an accepted schedule link joins the bank's documents through the hand-found path; it
// never overwrites the bank's own fee link or writes the unread source_validation_queue.
describe("accepting a source submission", () => {
  it("adds the link as a hand-found schedule and leaves fee_schedule_url alone", async () => {
    requireAuth.mockReset();
    requireAuth.mockResolvedValue({ id: 7 });
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([
      { id: 41, institution_id: 900, institution_name: "Example Bank", source_url: "https://example.bank/fees.pdf", review_status: "pending" },
    ]);
    const statements: string[] = [];
    const tx = vi.fn((strings: TemplateStringsArray) => {
      statements.push(strings.join("?"));
      return Promise.resolve([]);
    });
    withTransaction.mockReset();
    withTransaction.mockImplementation((fn: (scope: typeof tx) => Promise<unknown>) => fn(tx));
    addHandFoundLink.mockReset();
    addHandFoundLink.mockResolvedValue({ ok: true, institutionName: "Example Bank" });

    const form = new FormData();
    form.set("submission_id", "41");
    await actions.acceptSourceSubmission(form);

    expect(addHandFoundLink).toHaveBeenCalledWith(
      expect.objectContaining({ db: tx, institutionId: 900, url: "https://example.bank/fees.pdf" }),
    );
    expect(statements.some((text) => text.includes("UPDATE community_fee_submissions"))).toBe(true);
    expect(statements.some((text) => /fee_schedule_url|source_validation_queue/.test(text))).toBe(false);
  });
});

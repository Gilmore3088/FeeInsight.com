import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuth = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: (permission: string) => requireAuth(permission) }));
vi.mock("@/lib/admin-queries", () => ({ clearSourceSubmissionCountsCache: vi.fn() }));
vi.mock("@/lib/automation-control", () => ({ getAutomationControl: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), withTransaction: vi.fn() }));
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

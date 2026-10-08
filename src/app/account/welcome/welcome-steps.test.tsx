import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ saveOnboardingProfile: vi.fn() }));
vi.mock("@/components/hamilton/InstitutionPicker", () => ({ InstitutionPicker: () => <div>picker</div> }));

import { WelcomeSteps } from "./welcome-steps";

// Test figures only.
const user = { institution_name: null, institution_type: null, asset_tier: null, state_code: null, job_role: null };
const membership = {
  id: 1, institutionId: 8109, institutionName: "Space Coast Credit Union", city: null, stateCode: "FL",
  userId: 7, userDisplayName: null, userEmail: null, role: "owner", status: "active", source: "claim",
  claimId: 3, grantedByUserId: null, grantedAt: "2026-10-08T00:00:00Z",
} as never;

function renderSteps(isPro: boolean, workspaceMemberships: never[]) {
  return render(
    <WelcomeSteps
      userName="Pat Lee"
      user={user}
      feePreview={[]}
      districtName={null}
      districtId={null}
      isPro={isPro}
      pendingWorkspaceInvitations={[]}
      workspaceMemberships={workspaceMemberships}
    />,
  );
}

describe("WelcomeSteps", () => {
  it("does not ask a Pro buyer for the bank they chose at checkout", () => {
    renderSteps(true, [membership]);
    expect(screen.queryByText(/Which institution do you work for/)).toBeNull();
    expect(screen.getByText(/Space Coast Credit Union is saved as your institution/)).toBeTruthy();
  });

  it("asks a Pro member with no bank yet to pick one", () => {
    renderSteps(true, []);
    expect(screen.getByText(/Which institution do you work for/)).toBeTruthy();
  });
});

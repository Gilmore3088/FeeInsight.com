import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/app/pro/(hamilton)/reports/actions", () => ({ saveLandingResearchReport: mocks.save }));
vi.mock("./LandingResearchResults", () => ({ LandingResearchResults: () => <div>Selected evidence</div> }));
import { LandingReportConfirmation } from "./LandingReportConfirmation";
const selection = { version: 1 as const, task: "board_report" as const, scope: { kind: "national" as const }, charter: "bank" as const, categories: ["money_order"] };
beforeEach(() => { vi.clearAllMocks(); });
it("requires explicit confirmation and navigates to the saved report, not an unsaved PDF", async () => {
  mocks.save.mockResolvedValue({ success: true, reportId: "saved-report" });
  render(<LandingReportConfirmation selection={selection} />);
  const button = screen.getByRole("button", { name: "Create and save board draft" });
  expect(button).toBeDisabled(); expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(button);
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/pro/reports?report_id=saved-report"));
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ research: selection, confirmed: true });
});

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/app/pro/(hamilton)/reports/actions", () => ({ saveLandingResearchReport: mocks.save }));
vi.mock("./LandingResearchResults", () => ({ LandingResearchResults: () => <div>Selected evidence</div> }));
import { LandingReportConfirmation } from "./LandingReportConfirmation";
import type { LandingResearchHandoff } from "@/lib/hamilton/landing-research-handoff";
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

it.each<LandingResearchHandoff>([
  { ...selection, scope: { kind: "state", stateCode: "DC" } },
  { ...selection, charter: "credit_union" },
  { ...selection, categories: ["paper_statement"] },
  { ...selection, scope: { kind: "local", institutionId: 42 } },
])("requires fresh consent when the research selection changes: %j", next => {
  const { rerender } = render(<LandingReportConfirmation selection={selection} />);
  fireEvent.click(screen.getByRole("checkbox"));
  rerender(<LandingReportConfirmation selection={next} />);
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Create and save board draft" })).toBeDisabled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("preserves consent across an unchanged selection rerender", () => {
  const { rerender } = render(<LandingReportConfirmation selection={selection} />);
  fireEvent.click(screen.getByRole("checkbox"));
  rerender(<LandingReportConfirmation selection={{ ...selection, categories: [...selection.categories] }} />);
  expect(screen.getByRole("checkbox")).toBeChecked();
});

it("does not navigate to an old report when its save completes after scope navigation", async () => {
  let finish!: (value: { success: true; reportId: string }) => void;
  mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(<LandingReportConfirmation selection={selection} />);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Create and save board draft" }));
  rerender(<LandingReportConfirmation selection={{ ...selection, charter: "credit_union" }} />);
  await act(async () => finish({ success: true, reportId: "previous-selection" }));
  expect(mocks.push).not.toHaveBeenCalled();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Create and save board draft" })).toBeDisabled();
});

it("shows save failures and allows a deliberate retry without creating another automatic request", async () => {
  mocks.save.mockResolvedValueOnce({ success: false, error: "Storage unavailable" });
  render(<LandingReportConfirmation selection={selection} />);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Create and save board draft" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Storage unavailable");
  expect(screen.getByRole("button", { name: "Create and save board draft" })).toBeEnabled();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.push).not.toHaveBeenCalled();
});

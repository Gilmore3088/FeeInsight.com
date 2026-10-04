import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  signUp: vi.fn(),
  refresh: vi.fn(),
  resetSessionChrome: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/components/use-session-chrome", () => ({ resetSessionChrome: mocks.resetSessionChrome }));
vi.mock("@/app/account/alert-actions", () => ({
  saveInstitutionAlert: mocks.save,
  removeInstitutionAlert: mocks.remove,
  registerConsumerAndSaveAlert: mocks.signUp,
}));

import { FeeAlertControl } from "./fee-alert-control";

const base = {
  institutionId: 3,
  institutionName: "First Bank",
  focusCategory: "overdraft",
  categoryLabels: { overdraft: "Overdraft", nsf: "NSF" },
};

describe("FeeAlertControl", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves with one click when signed in", async () => {
    mocks.save.mockResolvedValue({ ok: true, feeCategories: ["overdraft"] });
    render(<FeeAlertControl {...base} initial={{ signedIn: true, saved: false, feeCategories: null }} />);
    expect(screen.getByRole("heading")).toHaveTextContent("changes its overdraft");
    fireEvent.click(screen.getByRole("button", { name: "Save First Bank" }));
    await waitFor(() => expect(screen.getByRole("heading")).toHaveTextContent("get an email when First Bank"));
    expect(mocks.save).toHaveBeenCalledWith({ institutionId: 3, feeCategory: "overdraft", allFees: false });
  });

  it("creates an account from email and password when signed out", async () => {
    mocks.signUp.mockResolvedValue({ ok: true, feeCategories: ["overdraft"] });
    render(<FeeAlertControl {...base} initial={{ signedIn: false, saved: false, feeCategories: null }} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create free account and save" }));
    await waitFor(() => expect(mocks.resetSessionChrome).toHaveBeenCalled());
    expect(mocks.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@b.com", password: "password1", institutionId: 3, feeCategory: "overdraft" }),
    );
    expect(screen.getByRole("link", { name: "Manage alerts" })).toHaveAttribute("href", "/account#alerts");
  });

  it("offers sign-in when the email already has an account", async () => {
    mocks.signUp.mockResolvedValue({ ok: false, error: "You already have an account.", loginHref: "/login?from=x" });
    render(<FeeAlertControl {...base} initial={{ signedIn: false, saved: false, feeCategories: null }} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create free account and save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("already have an account"));
    expect(screen.getByRole("link", { name: "Sign in instead" })).toHaveAttribute("href", "/login?from=x");
  });

  it("offers to add the focused fee when another fee is followed", () => {
    render(<FeeAlertControl {...base} initial={{ signedIn: true, saved: true, feeCategories: ["nsf"] }} />);
    expect(screen.getByRole("button", { name: "Also follow overdraft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Follow every fee" })).toBeInTheDocument();
  });

  it("uses verification copy on thin profiles", () => {
    render(
      <FeeAlertControl {...base} mode="verify" focusCategory={null} initial={{ signedIn: true, saved: false, feeCategories: null }} />,
    );
    expect(screen.getByRole("heading")).toHaveTextContent("fees are verified");
  });
});

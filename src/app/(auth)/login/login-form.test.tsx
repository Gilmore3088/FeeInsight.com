import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const reset = vi.fn();
const loginAction = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/use-session-chrome", () => ({ resetSessionChrome: () => reset() }));
vi.mock("./actions", () => ({ loginAction: (...args: unknown[]) => loginAction(...args) }));

import { LoginForm } from "./login-form";

function submit() {
  render(<LoginForm redirectTo="/account" forgotPasswordHref="/forgot-password" />);
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "a@b.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
  fireEvent.submit(screen.getByLabelText("Work email").closest("form")!);
}

describe("LoginForm", () => {
  beforeEach(() => {
    push.mockReset();
    reset.mockReset();
    loginAction.mockReset();
  });

  it("re-reads the header session before leaving /login", async () => {
    loginAction.mockResolvedValue({ success: true, redirect: "/account" });
    submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/account"));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(reset.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0]);
  });

  it("leaves the header alone when sign-in fails", async () => {
    loginAction.mockResolvedValue({ success: false, error: "Invalid email or password" });
    submit();
    await screen.findByText("Invalid email or password");
    expect(reset).not.toHaveBeenCalled();
  });
});

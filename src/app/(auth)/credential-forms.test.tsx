// @vitest-environment jsdom
/**
 * Before React hydrates, a form falls back to the browser's native submit. Without a method that
 * is a GET, which put the email and password in the URL (and request logs). Every form that takes
 * a password must say method="post" and keep its submit button disabled until hydrated.
 */
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/use-session-chrome", () => ({ resetSessionChrome: vi.fn() }));
vi.mock("./login/actions", () => ({ loginAction: vi.fn() }));
vi.mock("./register/actions", () => ({ register: vi.fn() }));
vi.mock("./reset-password/actions", () => ({ resetPassword: vi.fn() }));

import { LoginForm } from "./login/login-form";
import { RegisterForm } from "./register/register-form";
import { ResetPasswordForm } from "./reset-password/reset-password-form";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FORMS = [
  ["login", () => <LoginForm redirectTo="/account" forgotPasswordHref="/forgot-password" />],
  ["register", () => <RegisterForm />],
  ["reset password", () => <ResetPasswordForm token="t" />],
] as const;

describe.each(FORMS)("%s form", (_name, element) => {
  it("posts, and can't be submitted from the server HTML before hydration", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(element());
    const form = host.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });

  it("enables the submit button once hydrated", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(element());
    document.body.appendChild(host);
    await act(async () => {
      hydrateRoot(host, element());
    });
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    host.remove();
  });
});

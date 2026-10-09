// @vitest-environment jsdom
import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DarkModeToggle } from "./dark-mode-toggle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function stubColorScheme(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: dark && query.includes("dark"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  document.documentElement.classList.remove("dark");
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** Server HTML is rendered with no stored theme (the server can't see one), then hydrated in a browser that has one. */
async function hydrateWithStoredTheme(theme: "dark" | "light" | null, prefersDark = false) {
  stubColorScheme(false);
  const html = renderToString(<DarkModeToggle />);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);

  if (theme) localStorage.setItem("bfi-theme", theme);
  stubColorScheme(prefersDark);
  const recoverable: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(container, <DarkModeToggle />, {
      onRecoverableError: (error) => recoverable.push(error),
    });
  });
  return { container, recoverable };
}

describe("DarkModeToggle hydration", () => {
  it("hydrates without a mismatch when the browser has a stored dark theme, then shows it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container, recoverable } = await hydrateWithStoredTheme("dark");
    expect(recoverable).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("Switch to light mode");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    consoleError.mockRestore();
  });

  it("hydrates without a mismatch when the system prefers dark", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container, recoverable } = await hydrateWithStoredTheme(null, true);
    expect(recoverable).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(container.querySelector("button")!.getAttribute("aria-pressed")).toBe("true");
    consoleError.mockRestore();
  });

  it("toggles and remembers the choice; every toggle on the page follows", async () => {
    const { container } = await hydrateWithStoredTheme("light");
    const second = document.createElement("div");
    document.body.appendChild(second);
    const { createRoot } = await import("react-dom/client");
    const secondRoot = createRoot(second);
    await act(async () => secondRoot.render(<DarkModeToggle />));

    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await act(async () => button.click());
    expect(localStorage.getItem("bfi-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(second.querySelector("button")!.getAttribute("aria-pressed")).toBe("true");

    await act(async () => button.click());
    expect(localStorage.getItem("bfi-theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(second.querySelector("button")!.getAttribute("aria-pressed")).toBe("false");
    act(() => secondRoot.unmount());
  });
});

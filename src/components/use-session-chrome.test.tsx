import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { resetSessionChrome, SessionChromeProvider, useSessionChrome } from "./use-session-chrome";

function Probe() {
  const session = useSessionChrome();
  return <span>{session === null ? "loading" : session.signedIn ? "signed in" : "signed out"}</span>;
}

describe("useSessionChrome", () => {
  it("updates mounted islands when the session is reset after a client-side sign-in", async () => {
    const responses = [{ signedIn: false }, { signedIn: true, initial: "R" }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(responses.shift() ?? { signedIn: true }), { status: 200 })),
    );
    render(<Probe />);
    await screen.findByText("signed out");
    act(() => resetSessionChrome());
    await waitFor(() => expect(screen.getByText("signed in")).toBeInTheDocument());
  });

  it("starts from a server-supplied session and keeps it when /api/session fails", async () => {
    resetSessionChrome();
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    function ProProbe() {
      const session = useSessionChrome();
      return <span>{session?.isPro ? "pro" : "public"}</span>;
    }
    render(
      <SessionChromeProvider value={{ signedIn: true, isPro: true, initial: "J" }}>
        <ProProbe />
      </SessionChromeProvider>,
    );
    // Pro on first render, before the fetch settles: no flash of the public nav.
    expect(screen.getByText("pro")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getByText("pro")).toBeInTheDocument();
  });
});

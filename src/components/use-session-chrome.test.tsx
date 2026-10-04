import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { resetSessionChrome, useSessionChrome } from "./use-session-chrome";

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
});

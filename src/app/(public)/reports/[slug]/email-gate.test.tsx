import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmailGate } from "./email-gate";

describe("EmailGate", () => {
  it("says the PDF is still being built when there is none", () => {
    render(<EmailGate slug="q3" artifactExists={false} />);
    expect(screen.getByText("The PDF is being built. Check back soon.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("labels the email field and flags a bad address", () => {
    render(<EmailGate slug="q3" artifactExists />);
    const input = screen.getByLabelText("Work email");
    fireEvent.change(input, { target: { value: "not-an-email" } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByRole("alert").textContent).toBe("Please enter a valid email address.");
    expect(input.getAttribute("aria-describedby")).toBe("report-gate-error");
  });
});

describe("EmailGate success", () => {
  it("shows the download link, focuses it, and promises no email", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ downloadUrl: "https://files.example/q3.pdf" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { container } = render(<EmailGate slug="q3" artifactExists />);
      const input = screen.getByLabelText("Work email");
      fireEvent.change(input, { target: { value: "pat@bank.com" } });
      fireEvent.submit(input.closest("form")!);
      const link = await screen.findByRole("link", { name: "Download the PDF" });
      expect(link.getAttribute("href")).toBe("https://files.example/q3.pdf");
      // Focus moves in an effect after the success render; on a loaded CI runner it can land a tick later.
      await waitFor(() => expect(document.activeElement).toBe(link));
      expect(screen.getByText("The link works for one hour.")).toBeTruthy();
      expect(container.textContent ?? "").not.toMatch(/email|send/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

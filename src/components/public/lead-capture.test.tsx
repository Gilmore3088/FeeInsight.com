import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import { trackEvent } from "@/lib/analytics";
import { LeadCapture } from "./lead-capture";

const trackMock = trackEvent as unknown as ReturnType<typeof vi.fn>;

function renderState() {
  return render(
    <LeadCapture
      placement="state_benchmark"
      stateCode="OH"
      eyebrow="Free benchmark"
      headline="Get the free Ohio fee benchmark"
      body="Ohio medians against national."
      buttonLabel="Send it to me"
    />,
  );
}

function submit(email: string) {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.click(screen.getByRole("button"));
}

describe("LeadCapture", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    trackMock.mockReset();
    fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("tracks a view for its placement on mount", () => {
    renderState();
    expect(trackMock).toHaveBeenCalledWith("lead_capture_view", { placement: "state_benchmark", state: "OH" });
    expect(trackMock).toHaveBeenCalledTimes(1);
  });

  it("posts the placement source and state, then tracks submit and success", async () => {
    renderState();
    submit(" vp@bank.example ");
    await screen.findByRole("status");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/leads");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "vp@bank.example",
      source: "capture_state",
      state: "OH",
    });
    const events = trackMock.mock.calls.map(([name]) => name);
    expect(events).toEqual(["lead_capture_view", "lead_capture_submit", "lead_capture_success"]);
  });

  it("sends institution context for institution alerts", async () => {
    render(
      <LeadCapture
        placement="institution_alerts"
        institutionId={4802}
        institutionName="Example CU"
        eyebrow="Alerts"
        headline="Get alerted when Example CU changes fees"
        body="One email per verified change."
        buttonLabel="Alert me"
      />,
    );
    submit("vp@bank.example");
    await screen.findByRole("status");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      email: "vp@bank.example",
      source: "capture_institution",
      institutionId: 4802,
      institutionName: "Example CU",
    });
  });

  it("blocks personal email on the sample-report magnet before calling the API", () => {
    render(
      <LeadCapture
        placement="sample_report"
        eyebrow="Free sample"
        headline="Send the sample to your work inbox"
        body="Sample PDF."
        buttonLabel="Email me the sample"
      />,
    );
    submit("someone@gmail.com");
    expect(screen.getByRole("alert")).toHaveTextContent(/work email/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server error and tracks it", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Invalid email address" }), { status: 400 }));
    renderState();
    submit("vp@bank.example");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid email address"));
    expect(trackMock).toHaveBeenCalledWith("lead_capture_error", {
      placement: "state_benchmark",
      state: "OH",
      status: 400,
    });
  });

  it("renders the inline variant as just the field and button, still tracked and tagged", async () => {
    const { container } = render(
      <LeadCapture placement="homepage" variant="inline" headline="Get the sample report by email" buttonLabel="Send it" />,
    );
    expect(container.querySelector("section")).toBeNull();
    expect(screen.queryByText(/Unsubscribe anytime/)).toBeNull();
    expect(trackMock).toHaveBeenCalledWith("lead_capture_view", { placement: "homepage" });

    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "vp@bank.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Send it" }));
    await screen.findByRole("status");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      email: "vp@bank.example",
      source: "capture_homepage",
    });
  });
});

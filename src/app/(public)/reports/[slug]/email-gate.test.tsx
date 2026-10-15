import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

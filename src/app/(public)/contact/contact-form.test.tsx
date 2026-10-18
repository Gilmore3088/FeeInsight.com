import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ContactPage from "./page";
import { ContactForm } from "./contact-form";

vi.mock("@/lib/marketing-touch", () => ({ readFirstTouch: () => null }));

// The form reads the query in the browser, so the page itself can be prerendered (#1811).
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => params }));

async function renderPage(source?: string) {
  params = new URLSearchParams(source ? { source } : {});
  await act(async () => {
    render(<ContactPage />);
  });
}

describe("/contact", () => {
  it("reads as a demo request at ?source=demo, with the option shown whole", async () => {
    await renderPage("demo");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ask for a Hamilton demo");
    expect(document.body.textContent).toContain(
      "We walk you through Hamilton, the Fee Insight workspace, using your own market. We reply within one business day to set a time.",
    );
    const select = screen.getByLabelText("Inquiry type") as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe("Hamilton demo");
    expect(screen.getByRole("button", { name: "Ask for a demo" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Fee Insight Pro|Hamilton Pro/);

    // Choosing another option turns the heading, intro and button back into the general page.
    fireEvent.change(select, { target: { value: "report" } });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Get in touch");
    expect(document.body.textContent).not.toContain("We walk you through Hamilton");
    expect(document.body.textContent).toContain("We typically respond within one business day.");
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();

    // And choosing the demo again brings the demo heading back.
    fireEvent.change(select, { target: { value: "demo" } });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ask for a Hamilton demo");
    expect(screen.getByRole("button", { name: "Ask for a demo" })).toBeInTheDocument();
  });

  it("turns the general page into the demo request when the demo option is chosen", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Get in touch");
    fireEvent.change(screen.getByLabelText("Inquiry type"), { target: { value: "demo" } });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ask for a Hamilton demo");
    expect(screen.getByRole("button", { name: "Ask for a demo" })).toBeInTheDocument();
  });

  it("keeps the general page for other sources, and never files an unknown source as a demo", async () => {
    await renderPage("sample_report");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Get in touch");
    expect((screen.getByLabelText("Inquiry type") as HTMLSelectElement).value).toBe("general");
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
  });

  it("confirms a demo request with a reply to set a time", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      params = new URLSearchParams({ source: "demo" });
      render(<ContactForm />);
    });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "jane@example.com" } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Ask for a demo" }).closest("form")!);
    });
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).source).toBe("contact_demo");
    expect(screen.getByText("Request received")).toBeInTheDocument();
    expect(document.body.textContent).toContain("We'll reply within one business day to set a time.");
    vi.unstubAllGlobals();
  });
});

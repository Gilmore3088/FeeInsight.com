import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ContactPage from "./page";
import { ContactForm } from "./contact-form";

vi.mock("@/lib/marketing-touch", () => ({ readFirstTouch: () => null }));

async function renderPage(source?: string) {
  const params = Promise.resolve(source ? { source } : {});
  const page = await ContactPage({ searchParams: params });
  await act(async () => {
    render(page);
  });
}

describe("/contact", () => {
  it("reads as a demo request at ?source=demo, with the option shown whole", async () => {
    await renderPage("demo");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ask for a Hamilton demo");
    expect(document.body.textContent).toContain(
      "We walk you through Hamilton, the Fee Insight Pro workspace, using your own market. We reply within one business day to set a time.",
    );
    const select = screen.getByLabelText("Inquiry type") as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe("Hamilton demo");
    expect(screen.getByRole("button", { name: "Ask for a demo" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Fee Insight Pro(?! workspace)/);

    // Choosing another option turns the button back into a message.
    fireEvent.change(select, { target: { value: "report" } });
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
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
      render(<ContactForm searchParamsPromise={Promise.resolve({ source: "demo" })} />);
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

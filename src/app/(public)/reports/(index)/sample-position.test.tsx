import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SamplePosition } from "./sample-position";
import type { SampleExhibit } from "./report-view";

vi.mock("@/components/track-link", () => ({
  TrackLink: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const sample: SampleExhibit = {
  name: "Capital City Bank",
  place: "Tallahassee, FL",
  market: "Tallahassee, FL area (4 counties)",
  competitorsWithData: 29,
  competitorsInMarket: 41,
  findings: [],
  readOn: "2026-10-03",
  named: [],
  lines: [
    {
      key: "overdraft", label: "Overdraft (per item)", own: 30, ownFeeName: "Overdraft item", ownSourceUrl: null, ownReadOn: null,
      p25: 30, median: 32, p75: 35, min: 0, max: 36, peers: 20, chargingLess: 4, position: "in_market",
      peerFigures: [{ name: "First Bank", amount: 29, sourceUrl: "https://first.test/fees.pdf", readOn: "2026-09-30" }],
    },
    {
      key: "wire_intl_outgoing", label: "Outgoing international wire", own: 75, ownFeeName: "Wire transfer, outgoing international",
      ownSourceUrl: "https://ccb.test/fees.pdf", ownReadOn: "2026-10-01",
      p25: 45, median: 50, p75: 50, min: 25, max: 85, peers: 16, chargingLess: 15, position: "above_market",
      peerFigures: [
        { name: "First Bank", amount: 45, sourceUrl: "https://first.test/fees.pdf", readOn: "2026-09-30" },
        { name: "Second CU", amount: 50, sourceUrl: null, readOn: null },
      ],
    },
  ],
};

describe("SamplePosition (/reports demonstration)", () => {
  it("opens on the outgoing international wire, with the figures, insight and steps", () => {
    render(<SamplePosition sample={sample} />);
    expect((screen.getByLabelText("Select a fee") as HTMLSelectElement).value).toBe("wire_intl_outgoing");
    expect(screen.getAllByText("$75")).toHaveLength(2);
    expect(screen.getByText("Above the middle half")).toBeTruthy();
    expect(screen.getByText("16")).toBeTruthy();
    expect(screen.getByText(/is \$25 higher than the local median/)).toBeTruthy();
    expect(screen.getByText("Review wire volume and customer mix")).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Capital City Bank $75; local median $50; middle half $45 to $50",
    );
  });

  it("updates every dependent figure when another fee is picked", () => {
    render(<SamplePosition sample={sample} />);
    fireEvent.change(screen.getByLabelText("Select a fee"), { target: { value: "overdraft" } });
    expect(screen.getByText("Inside the middle half")).toBeTruthy();
    expect(screen.getByText("20")).toBeTruthy();
    expect(screen.getByText(/is \$2 lower than the local median and sits inside the middle half/)).toBeTruthy();
    expect(screen.getByText("Review how often it is charged, and to whom")).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Capital City Bank $30; local median $32; middle half $30 to $35",
    );
  });

  it("keeps the competitors, sources and method behind one disclosure", () => {
    const { container } = render(<SamplePosition sample={sample} />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    const table = within(details).getByRole("table");
    expect(within(table).getByText("Second CU")).toBeTruthy();
    expect(within(table).getByRole("link", { name: "Schedule, September 30, 2026" }).getAttribute("href")).toBe("https://first.test/fees.pdf");
    expect(within(details).getByText(/29 of the 41 institutions in Tallahassee, FL area \(4 counties\) have verified fees; 16 publish this one/)).toBeTruthy();
    expect(within(details).getByRole("link", { name: "its published fee schedule" }).getAttribute("href")).toBe("https://ccb.test/fees.pdf");
  });
});

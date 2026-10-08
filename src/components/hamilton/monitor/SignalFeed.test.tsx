import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AlertEntry, SignalEntry } from "@/lib/hamilton/home-data";
import { SignalFeed, deriveWhatChanged, formatChangeKind } from "./SignalFeed";
import { parseCompetitorChangeDetail } from "@/lib/hamilton/competitor-alert-detail";

const signal: SignalEntry = {
  id: "signal-1",
  institutionId: "2945",
  signalType: "hamilton_fee_movement_detected",
  severity: "high",
  title: "Example Bank - overdraft fee moved",
  body: "Overdraft rose from $32.00 to $35.00. Three of its state peers charge less.",
  createdAt: "2026-08-15T12:00:00.000Z",
  evidencePolicy: "verified-only",
  providerCallQueued: false,
};

describe("SignalFeed", () => {
  it("preserves selected institution context from the empty-state Settings CTA", () => {
    const html = renderToStaticMarkup(
      <SignalFeed signals={[]} selectedInstitutionId="2945" />,
    );

    expect(html).toContain('href="/pro/settings?instId=2945"');
  });

  it("renders a change in plain language with its follow-up link and no legacy styling", () => {
    const html = renderToStaticMarkup(<SignalFeed signals={[signal]} />);

    expect(html).toContain("Fee change");
    expect(html).toContain("Example Bank");
    expect(html).toContain("Overdraft rose from $32.00 to $35.00.");
    expect(html).toContain("Three of its state peers charge less.");
    expect(html).toContain('href="/pro/reports?intent=fee-movement&amp;instId=2945"');
    expect(html).toContain("Rerun the brief");
    expect(html).not.toContain("var(--hamilton");
    expect(html).not.toContain("Recommended Next Move");
    expect(html).not.toContain("Risk Score");
  });

  it("marks the top alert and keeps it first", () => {
    const alert: AlertEntry = {
      id: "alert-1",
      signalId: "signal-0",
      institutionId: "2945",
      signalType: "darwin_verification_needs_review",
      severity: "high",
      title: "Example Bank - schedule changed",
      body: "The posted schedule no longer matches.",
      status: "active",
      createdAt: "2026-08-16T12:00:00.000Z",
    };
    const html = renderToStaticMarkup(<SignalFeed signals={[signal]} topAlert={alert} />);

    expect(html.indexOf("Alert:")).toBeGreaterThan(-1);
    expect(html.indexOf("Alert:")).toBeLessThan(html.indexOf("Fee change"));
  });
});

describe("change helpers", () => {
  it("keeps decimal amounts whole when taking the first sentence", () => {
    expect(deriveWhatChanged("Fee is now $2.50 per item. More detail.")).toBe("Fee is now $2.50 per item.");
    expect(deriveWhatChanged("No period at the end")).toBe("No period at the end.");
  });

  it("names change kinds without internal agent names", () => {
    expect(formatChangeKind("darwin_verification_completed")).toBe("Fees verified");
    expect(formatChangeKind("hamilton_scenario_drift")).toBe("Scenario drift");
    expect(formatChangeKind("hamilton_competitor_fee_change")).toBe("Competitor fee change");
    expect(formatChangeKind("source_missing")).toBe("Fee schedule source");
  });

  it("draws a competitor fee change as a report exhibit with the bank's own price", () => {
    const competitor: SignalEntry = {
      ...signal,
      id: "signal-9",
      signalType: "hamilton_competitor_fee_change",
      severity: "medium",
      title: "Lone Star CU raised its overdraft fee from $30.00 to $35.00",
      body: "Home Bank charges $32.00, $3.00 lower.",
      competitorChange: parseCompetitorChangeDetail({
        competitor_name: "Lone Star CU",
        bank_name: "Home Bank",
        canonical_fee_key: "overdraft",
        previous_amount: 30,
        new_amount: 35,
        own_amount: 32,
        changed_at: "2026-10-06",
        schedule_url: "https://lonestar.example/fees.pdf",
      }),
    };
    const html = renderToStaticMarkup(<SignalFeed signals={[competitor]} />);

    expect(html).toContain("Competitor watch · Overdraft");
    expect(html).toContain("rd-table");
    expect(html).toContain('class="rd-subject"');
    expect(html).toContain("$30.00");
    expect(html).toContain("$35.00");
    expect(html).toContain("$32.00");
    expect(html).toContain("Lone Star CU&#x27;s published fee schedule, Oct 6, 2026");
    expect(html).toContain('href="https://lonestar.example/fees.pdf"');
    expect(html).not.toMatch(/cheapest|cheaper|dearest|\u2014/);
  });

  it("falls back to the plain card when a competitor row has no prices", () => {
    const html = renderToStaticMarkup(
      <SignalFeed signals={[{ ...signal, signalType: "hamilton_competitor_fee_change", competitorChange: parseCompetitorChangeDetail({}) }]} />,
    );
    expect(html).not.toContain("rd-table");
    expect(html).toContain("Overdraft rose from $32.00 to $35.00.");
  });
});

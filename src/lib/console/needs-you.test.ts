import { describe, expect, it } from "vitest";
import type { AttentionItem } from "@/lib/admin-command-center";
import type { LeadRow } from "@/lib/admin-queries";
import { buildNeedsYou, needsYouHeadline } from "./needs-you";

const now = new Date("2026-10-06T12:00:00Z"); // a Tuesday

function lead(overrides: Partial<LeadRow>): LeadRow {
  return {
    id: 1,
    name: "Pat Lee",
    email: "pat@example.com",
    company: "Example Bank",
    role: null,
    use_case: null,
    source: "report",
    status: "new",
    created_at: "2026-10-06",
    created_at_iso: "2026-10-06T08:00:00Z",
    quote_cents: null,
    quote_institution_id: null,
    quote_sent_at: null,
    paid_at: null,
    refunded_at: null,
    payment_columns: true,
    qualified_at: null,
    qualified_by: null,
    qualified_columns: true,
    ...overrides,
  };
}

const attention = (overrides: Partial<AttentionItem>): AttentionItem => ({
  id: "review:knox",
  severity: "work",
  owner: "knox",
  title: "3 Knox decisions need a human verdict",
  detail: "Confirm or override.",
  href: "/admin/knox?queue=decisions",
  action: "Review Knox decisions",
  ...overrides,
});

describe("buildNeedsYou", () => {
  it("is empty when nothing is waiting", () => {
    const items = buildNeedsYou({ attention: [], failureAlerts: [], leads: [], now });
    expect(items).toEqual([]);
    expect(needsYouHeadline(items)).toBe("Nothing needs you.");
  });

  it("leaves out standing backlog the agents handle themselves", () => {
    const items = buildNeedsYou({
      attention: [attention({ id: "coverage:urls", severity: "warning", owner: "magellan" })],
      failureAlerts: [],
      leads: [],
      now,
    });
    expect(items).toEqual([]);
  });

  it("orders critical before warnings before work, keeping source order within each", () => {
    const items = buildNeedsYou({
      attention: [
        attention({}),
        attention({ id: "pipeline:paused", severity: "critical", owner: "atlas", title: "Pipeline is paused" }),
      ],
      failureAlerts: [{ key: "step:read", title: "Reading is failing", message: "8 of 10 failed.", failures: 8, total: 10, latestAt: null }],
      leads: [lead({})],
      now,
    });
    expect(items.map((item) => item.id)).toEqual([
      "failure:step:read",
      "attention:pipeline:paused",
      "lead:1",
      "attention:review:knox",
    ]);
    expect(items[1].area).toBe("Controls");
    expect(needsYouHeadline(items)).toBe("4 things need you.");
  });

  it("says when a lead's reply is due, and when it is late", () => {
    const [due] = buildNeedsYou({ attention: [], failureAlerts: [], leads: [lead({})], now });
    expect(due.severity).toBe("warning");
    expect(due.title).toBe("Reply due in 20 hours: Pat Lee, Example Bank");

    const [late] = buildNeedsYou({
      attention: [],
      failureAlerts: [],
      leads: [lead({ created_at_iso: "2026-10-05T08:00:00Z", status: "overdue" })],
      now,
    });
    expect(late.severity).toBe("critical");
    expect(late.title).toBe("Reply overdue by 4 hours: Pat Lee, Example Bank");
  });

  it("skips subscriptions and answered requests", () => {
    const items = buildNeedsYou({
      attention: [],
      failureAlerts: [],
      leads: [lead({ source: "newsletter" }), lead({ id: 2, status: "sent" })],
      now,
    });
    expect(items).toEqual([]);
  });

  it("brings back an emailed quote nobody paid after 5 business days", () => {
    const quoted = lead({ status: "quoted", quote_cents: 30000, quote_sent_at: "2026-09-28T12:00:00Z" });
    const [item] = buildNeedsYou({ attention: [], failureAlerts: [], leads: [quoted], now });
    expect(item).toMatchObject({ id: "quote:1", severity: "work", area: "Customers" });
    expect(item.title).toContain("Quote unpaid for 8 days");
  });

  it("leaves a fresh, paid or never-emailed quote alone", () => {
    const leads = [
      lead({ id: 2, status: "quoted", quote_sent_at: "2026-10-05T12:00:00Z" }),
      lead({ id: 3, status: "paid", quote_sent_at: "2026-09-01T12:00:00Z", paid_at: "2026-09-02T12:00:00Z" }),
      lead({ id: 4, status: "quoted", quote_sent_at: null }),
    ];
    expect(buildNeedsYou({ attention: [], failureAlerts: [], leads, now })).toEqual([]);
  });
});

describe("buildNeedsYou: Darwin's held fees past their age limit (#1115 step 2)", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const group = (cause: string, oldest: string, hasExit: boolean, count = 74) => ({
    cause, label: cause, count, oldest, example: null, wayOut: hasExit ? "Darwin's release pass." : "None yet.", hasExit,
  });

  it("raises a reason with no way out after 7 days, and one with a way out after 14", () => {
    const items = buildNeedsYou({
      attention: [],
      failureAlerts: [],
      leads: [],
      now,
      holds: [
        group("conditional_zero", "2026-10-09T11:25:00Z", false),
        group("outside_envelope", "2026-10-10T00:00:00Z", true, 3243),
        group("peer_outlier", "2026-10-05T00:00:00Z", true, 2792),
      ],
    });
    expect(items.map((item) => item.id)).toEqual(["hold:conditional_zero", "hold:peer_outlier"]);
    expect(items[0]).toMatchObject({ severity: "warning", href: "/admin/darwin" });
    expect(items[0].title).toBe("74 fees held 11 days: conditional_zero");
  });

  it("raises nothing inside the limit, or when the holds could not be read", () => {
    expect(buildNeedsYou({ attention: [], failureAlerts: [], leads: [], now, holds: [group("conditional_zero", "2026-10-15T00:00:00Z", false)] })).toEqual([]);
    expect(buildNeedsYou({ attention: [], failureAlerts: [], leads: [], now, holds: null })).toEqual([]);
  });
});

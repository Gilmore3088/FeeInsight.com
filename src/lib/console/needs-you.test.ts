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
});

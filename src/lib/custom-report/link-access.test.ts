import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/report-payments", () => ({ isPurchaseLive: vi.fn(), isReportRevoked: vi.fn() }));

import { reportLinkOpens, type ReportLinkStore } from "./link-access";

const ISSUED = new Date("2026-10-20T00:00:00Z");
const EXPIRES = new Date("2027-01-18T00:00:00Z");

function store(livePurchases: number[], revokedBanks: number[] = []): ReportLinkStore {
  return {
    isPurchaseLive: async (purchaseId, institutionId) => institutionId === 201 && livePurchases.includes(purchaseId),
    isReportRevoked: async (institutionId) => revokedBanks.includes(institutionId),
  };
}

describe("reportLinkOpens (#2000)", () => {
  it("should_open_a_purchase_link_while_its_payment_is_live", async () => {
    const verified = { institutionId: 201, purchaseId: 77, issuedOn: ISSUED, expiresOn: EXPIRES };
    expect(await reportLinkOpens(verified, store([77]))).toBe(true);
  });

  it("should_close_a_purchase_link_once_its_payment_is_refunded", async () => {
    const verified = { institutionId: 201, purchaseId: 77, issuedOn: ISSUED, expiresOn: EXPIRES };
    // Another buyer's live payment for the same bank does not keep this buyer's link open.
    expect(await reportLinkOpens(verified, store([78]))).toBe(false);
  });

  it("should_keep_a_legacy_link_open_unless_every_payment_for_the_bank_was_refunded", async () => {
    const legacy = { institutionId: 201, purchaseId: null, issuedOn: ISSUED, expiresOn: EXPIRES };
    expect(await reportLinkOpens(legacy, store([]))).toBe(true);
    expect(await reportLinkOpens(legacy, store([], [201]))).toBe(false);
  });
});

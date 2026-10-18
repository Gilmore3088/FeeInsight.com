// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StripeEventEffects } from "@/lib/stripe-webhook";

const m = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("@/lib/data-store/payment-outbox", () => ({
  enqueuePaymentEmail: m.enqueue, claimPaymentEmail: vi.fn(), finishPaymentEmail: vi.fn(), paymentEmailStatus: vi.fn(),
}));

import { stagePaymentEmails } from "./payment-delivery";

const effects = (welcome: StripeEventEffects["welcome"]): StripeEventEffects =>
  ({ welcome, reportPaid: [], reportDuplicate: [], reportRefunded: [] });
const pat = { email: "pat@example.invalid", name: "Pat", checkoutSessionId: "cs_1", userId: 7 };

describe("stagePaymentEmails welcome (#1972)", () => {
  beforeEach(() => {
    m.enqueue.mockReset();
    vi.stubEnv("TRANSACTIONAL_EMAIL_FROM", "Fee Insight <test@example.invalid>");
  });

  it("keys the welcome by checkout session and user, not by event", async () => {
    m.enqueue.mockResolvedValue(true);
    expect(await stagePaymentEmails({} as never, "evt_completed", effects([pat]))).toEqual(["pat@example.invalid"]);
    expect(m.enqueue).toHaveBeenCalledWith({}, expect.objectContaining({ eventId: "evt_completed", key: "welcome/cs_1/7", kind: "welcome" }));
  });

  it("reports nothing newly welcomed when another event already staged that checkout's welcome", async () => {
    m.enqueue.mockResolvedValue(false);
    expect(await stagePaymentEmails({} as never, "evt_async", effects([pat]))).toEqual([]);
    expect(m.enqueue).toHaveBeenCalledWith({}, expect.objectContaining({ key: "welcome/cs_1/7" }));
  });
});

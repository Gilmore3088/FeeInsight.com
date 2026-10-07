import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  sendResendEmail: vi.fn(),
  getTransactionalFromAddress: vi.fn(() => "alerts@feeinsight.com"),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/email/resend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/resend")>("@/lib/email/resend");
  return {
    ...actual,
    sendResendEmail: mocks.sendResendEmail,
    getTransactionalFromAddress: mocks.getTransactionalFromAddress,
  };
});

import {
  buildFeeAlertEmail,
  feeAlertIdempotencyKey,
  groupFeeAlertCandidates,
  runFeeAlertDispatch,
  summarizeFeeAlertDispatch,
  type CandidateRow,
} from "./fee-alerts";

function movement(overrides: Partial<CandidateRow> = {}, movements: unknown[] = []): CandidateRow {
  return {
    subscription_id: 1,
    user_id: 7,
    institution_id: 3,
    fee_categories: ["overdraft"],
    email: "reader@example.com",
    display_name: "reader",
    institution_name: "First Bank",
    signal_id: "sig-move",
    signal_type: "hamilton_fee_movement_detected",
    signal_at: "2026-10-02T10:00:00.000Z",
    source_json: {
      batch_id: "b1",
      movements: movements.length
        ? movements
        : [{ canonical_fee_key: "overdraft", fee_name: "Overdraft fee", previous_amount: 32, new_amount: 35, amount_delta: 3 }],
    },
    ...overrides,
  };
}

function publication(keys: string[], overrides: Partial<CandidateRow> = {}): CandidateRow {
  return movement({
    signal_id: "sig-pub",
    signal_type: "hamilton_publication_completed",
    source_json: { batch_id: "b1", canonical_fee_keys: keys },
    ...overrides,
  });
}

function templateText(call: unknown[]): string {
  return (call[0] as TemplateStringsArray).join("?").replace(/\s+/g, " ");
}

describe("groupFeeAlertCandidates", () => {
  it("keeps only fees the reader follows", () => {
    const [digest] = groupFeeAlertCandidates([
      movement({}, [
        { canonical_fee_key: "overdraft", previous_amount: 32, new_amount: 35 },
        { canonical_fee_key: "nsf", previous_amount: 30, new_amount: 25 },
      ]),
    ]);
    expect(digest.institutions[0].changes.map((change) => change.category)).toEqual(["overdraft"]);
    expect(digest.institutions[0].changes[0].delta).toBe(3);
  });

  it("treats a null category list as every fee", () => {
    const [digest] = groupFeeAlertCandidates([
      movement({ fee_categories: null }, [
        { canonical_fee_key: "overdraft", previous_amount: 32, new_amount: 35 },
        { canonical_fee_key: "nsf", previous_amount: 30, new_amount: 25 },
      ]),
    ]);
    expect(digest.institutions[0].changes).toHaveLength(2);
  });

  it("reports a first publication only for keys that did not also move in the batch", () => {
    const [digest] = groupFeeAlertCandidates([
      movement({ fee_categories: null }),
      publication(["overdraft", "nsf", "atm_non_network"], { fee_categories: null }),
    ]);
    const institution = digest.institutions[0];
    expect(institution.changes.map((change) => change.category)).toEqual(["overdraft"]);
    expect(institution.newlyPublished.map((item) => item.category)).toEqual(["nsf", "atm_non_network"]);
  });

  it("keeps a reader whose signals touched nothing they follow, with no institutions", () => {
    const [digest] = groupFeeAlertCandidates([publication(["nsf"])]);
    expect(digest.institutions).toEqual([]);
    expect(digest.subscriptionIds).toEqual([1]);
    expect(digest.maxSignalAt).toBe("2026-10-02T10:00:00.000Z");
  });

  it("tracks the newest signal as the next high-water mark", () => {
    const [digest] = groupFeeAlertCandidates([
      movement(),
      movement({ signal_id: "later", signal_at: "2026-10-03T08:00:00.000Z", subscription_id: 2, institution_id: 4 }),
    ]);
    expect(digest.maxSignalAt).toBe("2026-10-03T08:00:00.000Z");
    expect(digest.subscriptionIds).toEqual([1, 2]);
  });

  it("tolerates source_json stored as a JSON string", () => {
    const [digest] = groupFeeAlertCandidates([
      movement({
        source_json: JSON.stringify({ movements: [{ canonical_fee_key: "overdraft", previous_amount: 30, new_amount: 28 }] }),
      }),
    ]);
    expect(digest.institutions[0].changes[0].delta).toBe(-2);
  });
});

describe("buildFeeAlertEmail", () => {
  it("names the bank, the fee and the new amount for a single change", () => {
    const [digest] = groupFeeAlertCandidates([movement()]);
    const email = buildFeeAlertEmail(digest, { site: "https://feeinsight.com", unsubscribePage: "https://u" });
    expect(email.subject).toBe("First Bank raised its overdraft fee to $35.00");
    expect(email.text).toContain("$32.00 → $35.00 (up $3.00)");
    expect(email.text).toContain("https://feeinsight.com/institution/3?fee=overdraft#fee-overdraft");
    expect(email.text).toContain("https://u");
    expect(email.text).toContain("/account#alerts");
  });

  it("is stable for the same signals", () => {
    expect(feeAlertIdempotencyKey(7, ["b", "a"])).toBe(feeAlertIdempotencyKey(7, ["a", "b"]));
    expect(feeAlertIdempotencyKey(7, ["a"])).not.toBe(feeAlertIdempotencyKey(8, ["a"]));
  });
});

describe("runFeeAlertDispatch", () => {
  beforeEach(() => {
    vi.stubEnv("LEAD_EMAIL_TOKEN_SECRET", "secret");
    mocks.sql.mockReset();
    mocks.sendResendEmail.mockReset();
    mocks.getTransactionalFromAddress.mockReturnValue("alerts@feeinsight.com");
  });

  function installCandidates(rows: CandidateRow[], watchlistRows: Array<Record<string, unknown>> = []) {
    mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("FROM institution_fee_alert_subscriptions sub")) return Promise.resolve(rows);
      if (text.includes("FROM hamilton_watchlists w")) return Promise.resolve(watchlistRows);
      return Promise.resolve([]);
    });
  }

  function watched(overrides: Record<string, unknown> = {}) {
    return {
      ...movement({ subscription_id: null, user_id: 20, email: "pro@example.com", signal_id: "sig-w" }),
      role: "premium",
      subscription_status: "active",
      past_due_since: null,
      ...overrides,
    };
  }

  const watchlistUpdates = () =>
    mocks.sql.mock.calls.map(templateText).filter((text) => text.includes("UPDATE hamilton_watchlists"));

  const updates = () => mocks.sql.mock.calls.map(templateText).filter((text) => text.includes("SET last_alerted_at"));

  it("sends one email per reader and only then advances the high-water mark", async () => {
    installCandidates([movement()]);
    mocks.sendResendEmail.mockResolvedValue({ status: "sent", id: "e1" });
    const result = await runFeeAlertDispatch();
    expect(result).toMatchObject({ readers: 1, sent: 1, failed: 0, notConfigured: false });
    const [message] = mocks.sendResendEmail.mock.calls[0];
    expect(message.to).toBe("reader@example.com");
    expect(message.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(message.headers["List-Unsubscribe"]).toContain("/api/alerts/unsubscribe?");
    expect(updates()).toHaveLength(1);
  });

  it("leaves a failed send for the next run", async () => {
    installCandidates([movement()]);
    mocks.sendResendEmail.mockResolvedValue({ status: "failed", error: "rate limited" });
    const result = await runFeeAlertDispatch();
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(updates()).toHaveLength(0);
  });

  it("does not mark anyone when email is not configured", async () => {
    installCandidates([movement()]);
    mocks.getTransactionalFromAddress.mockReturnValue("");
    const result = await runFeeAlertDispatch();
    expect(result.notConfigured).toBe(true);
    expect(mocks.sendResendEmail).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
    expect(summarizeFeeAlertDispatch(result)).toContain("did not email them");
    expect(summarizeFeeAlertDispatch(result)).not.toMatch(/\.\.$/);
  });

  it("moves past signals about fees nobody follows even without email", async () => {
    installCandidates([publication(["nsf"])]);
    mocks.getTransactionalFromAddress.mockReturnValue("");
    const result = await runFeeAlertDispatch();
    expect(result.readers).toBe(0);
    expect(updates()).toHaveLength(1);
  });

  it("changes nothing on a dry run", async () => {
    installCandidates([movement()]);
    const result = await runFeeAlertDispatch({ dryRun: true });
    expect(result).toMatchObject({ dryRun: true, readers: 1 });
    expect(mocks.sendResendEmail).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });

  it("caps recipients per run and reports the rest as deferred", async () => {
    installCandidates([movement(), movement({ user_id: 8, subscription_id: 9, email: "two@example.com" })]);
    mocks.sendResendEmail.mockResolvedValue({ status: "sent", id: "e" });
    const result = await runFeeAlertDispatch({ maxRecipients: 1 });
    expect(result).toMatchObject({ sent: 1, deferred: 1 });
    expect(summarizeFeeAlertDispatch(result)).toContain("1 reader(s) wait for the next run");
  });

  describe("Pro watchlists", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("counts and renders watchlist news but sends nothing while PRO_EMAILS_ENABLED is off", async () => {
      vi.stubEnv("LEAD_EMAIL_TOKEN_SECRET", "secret");
      installCandidates([], [watched()]);
      const result = await runFeeAlertDispatch();
      expect(result).toMatchObject({ readers: 0, sent: 0, watchlistReaders: 1, watchlistHeld: true });
      expect(result.previews).toHaveLength(1);
      expect(result.previews[0].to).toBe("p***@example.com");
      expect(result.previews[0].text).toContain("watch them in Hamilton");
      expect(mocks.sendResendEmail).not.toHaveBeenCalled();
      expect(watchlistUpdates()).toHaveLength(0);
      expect(summarizeFeeAlertDispatch(result)).toContain("1 Pro reader(s) have watchlist news held because PRO_EMAILS_ENABLED is off");
    });

    it("sends watchlist news and advances the watchlist mark once switched on", async () => {
      vi.stubEnv("LEAD_EMAIL_TOKEN_SECRET", "secret");
      vi.stubEnv("PRO_EMAILS_ENABLED", "true");
      installCandidates([], [watched()]);
      mocks.sendResendEmail.mockResolvedValue({ status: "sent", id: "e1" });
      const result = await runFeeAlertDispatch();
      expect(result).toMatchObject({ readers: 1, sent: 1, watchlistHeld: false });
      expect(mocks.sendResendEmail.mock.calls[0][0].to).toBe("pro@example.com");
      expect(watchlistUpdates()).toHaveLength(1);
      expect(updates().filter((text) => text.includes("institution_fee_alert_subscriptions"))).toHaveLength(0);
    });

    it("merges a saved and a watched institution into one email without repeating a signal", async () => {
      vi.stubEnv("LEAD_EMAIL_TOKEN_SECRET", "secret");
      vi.stubEnv("PRO_EMAILS_ENABLED", "on");
      const saved = movement({ user_id: 20, email: "pro@example.com", signal_id: "same" });
      installCandidates([saved], [watched({ signal_id: "same" })]);
      mocks.sendResendEmail.mockResolvedValue({ status: "sent", id: "e1" });
      const result = await runFeeAlertDispatch();
      expect(result).toMatchObject({ readers: 1, sent: 1, changes: 1 });
      expect(mocks.sendResendEmail).toHaveBeenCalledTimes(1);
      expect(watchlistUpdates()).toHaveLength(1);
    });

    it("leaves out readers without Pro access", async () => {
      vi.stubEnv("PRO_EMAILS_ENABLED", "true");
      installCandidates([], [watched({ role: "viewer", subscription_status: "canceled" })]);
      const result = await runFeeAlertDispatch({ dryRun: true });
      expect(result).toMatchObject({ readers: 0, watchlistReaders: 0 });
    });

    it("shows watchlist readers on a dry run without sending or marking", async () => {
      installCandidates([movement()], [watched()]);
      const result = await runFeeAlertDispatch({ dryRun: true });
      expect(result).toMatchObject({ dryRun: true, readers: 2, watchlistReaders: 1 });
      expect(result.previews).toHaveLength(2);
      expect(mocks.sendResendEmail).not.toHaveBeenCalled();
      expect(watchlistUpdates()).toHaveLength(0);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  sendResendEmail: vi.fn(),
  getTransactionalFromAddress: vi.fn(() => "digest@feeinsight.com"),
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
  buildProDigestEmail,
  computePositions,
  diffCompetitors,
  diffPositions,
  digestHasNews,
  digestWeekStart,
  netMarketMoves,
  runProDigest,
  summarizeProDigest,
  toDigestReaders,
  type DigestReaderRow,
  type ProDigest,
} from "./pro-digest";

function readerRow(overrides: Partial<DigestReaderRow> = {}): DigestReaderRow {
  return {
    user_id: 20,
    email: "pro@example.com",
    display_name: "Pat",
    role: "premium",
    subscription_status: "active",
    past_due_since: null,
    state_code: null,
    fed_district: null,
    own_institution_id: 1,
    own_institution_name: "Home Bank",
    own_state_code: "TX",
    own_fed_district: 11,
    watched_ids: ["2", 3],
    ...overrides,
  };
}

function signal(institutionId: number, name: string, state: string, district: number, at: string, movements: unknown[]) {
  return { institution_id: institutionId, institution_name: name, state_code: state, fed_district: district, signal_at: at, source_json: { movements } };
}

const od = (previous: number, next: number) => ({ canonical_fee_key: "overdraft", previous_amount: previous, new_amount: next });

describe("digestWeekStart", () => {
  it("is the Monday of the week in UTC", () => {
    expect(digestWeekStart(new Date("2026-10-12T13:11:00Z"))).toBe("2026-10-12");
    expect(digestWeekStart(new Date("2026-10-07T01:00:00Z"))).toBe("2026-10-05");
    expect(digestWeekStart(new Date("2026-10-11T23:59:00Z"))).toBe("2026-10-05");
  });
});

describe("toDigestReaders", () => {
  it("keeps Pro readers only and takes the market from their institution", () => {
    const readers = toDigestReaders([
      readerRow({ state_code: "CA" }),
      readerRow({ user_id: 21, role: "viewer", subscription_status: "canceled" }),
    ]);
    expect(readers).toHaveLength(1);
    expect(readers[0]).toMatchObject({ stateCode: "TX", fedDistrict: 11, own: { institutionId: 1 }, watchedIds: [2, 3] });
  });

  it("drops the reader's own institution from the watched list", () => {
    expect(toDigestReaders([readerRow({ watched_ids: [1, 2] })])[0].watchedIds).toEqual([2]);
  });
});

describe("netMarketMoves", () => {
  it("nets a week of movements per fee and drops a round trip", () => {
    const moves = netMarketMoves([
      signal(5, "Lone Star CU", "TX", 11, "2026-10-08T00:00:00Z", [od(30, 35)]),
      signal(5, "Lone Star CU", "TX", 11, "2026-10-09T00:00:00Z", [od(35, 33)]),
      signal(6, "Gulf Bank", "TX", 11, "2026-10-08T00:00:00Z", [od(25, 28)]),
      signal(6, "Gulf Bank", "TX", 11, "2026-10-10T00:00:00Z", [od(28, 25)]),
    ]);
    expect(moves).toEqual([
      expect.objectContaining({ institutionId: 5, category: "overdraft", previousAmount: 30, newAmount: 33 }),
    ]);
  });
});

describe("positions", () => {
  const fees = [
    { institution_id: 1, fee_category: "overdraft", amount: 30 },
    { institution_id: 2, fee_category: "overdraft", amount: 25 },
    { institution_id: 3, fee_category: "overdraft", amount: 35 },
    { institution_id: 4, fee_category: "overdraft", amount: 30 },
    { institution_id: 1, fee_category: "not_a_headline_fee", amount: 1 },
  ];

  it("counts state peers charging less and ignores non-headline fees", () => {
    expect(computePositions(1, fees)).toEqual({ overdraft: { amount: 30, lower: 1, of: 4 } });
  });

  it("reports a change only against a snapshot", () => {
    const now = { overdraft: { amount: 30, lower: 2, of: 5 } };
    expect(diffPositions(now, null)).toEqual([]);
    expect(diffPositions(now, { overdraft: { amount: 30, lower: 2, of: 5 } })).toEqual([]);
    expect(diffPositions(now, { overdraft: { amount: 30, lower: 1, of: 4 } })).toHaveLength(1);
  });
});

describe("diffCompetitors", () => {
  it("lists moved and newly published fees, but nothing for a newly watched institution", () => {
    const changes = diffCompetitors(
      {
        "2": { name: "Gulf Bank", fees: { overdraft: 28, nsf: 30 } },
        "3": { name: "New Watch", fees: { overdraft: 20 } },
      },
      { "2": { name: "Gulf Bank", fees: { overdraft: 25 } } },
    );
    expect(changes).toEqual([
      { institutionId: 2, institutionName: "Gulf Bank", category: "overdraft", previousAmount: 25, newAmount: 28 },
      { institutionId: 2, institutionName: "Gulf Bank", category: "nsf", previousAmount: null, newAmount: 30 },
    ]);
  });
});

describe("buildProDigestEmail", () => {
  const digest: ProDigest = {
    reader: { userId: 20, email: "pro@example.com", displayName: "Pat", stateCode: "TX", fedDistrict: 11, own: { institutionId: 1, name: "Home Bank" }, watchedIds: [2] },
    weekStart: "2026-10-12",
    stateMoves: [
      { institutionId: 5, institutionName: "Lone Star CU", stateCode: "TX", fedDistrict: 11, category: "overdraft", previousAmount: 30, newAmount: 33 },
      { institutionId: 6, institutionName: "Gulf Bank", stateCode: "TX", fedDistrict: 11, category: "overdraft", previousAmount: 28, newAmount: 25 },
    ],
    districtMoves: [],
    positionChanges: [{ category: "overdraft", now: { amount: 30, lower: 2, of: 5 }, before: { amount: 30, lower: 1, of: 4 } }],
    competitorChanges: [],
  };

  it("says lower and higher, names the position, and carries the stop link", () => {
    const email = buildProDigestEmail(digest, { site: "https://feeinsight.com", unsubscribePage: "https://feeinsight.com/stop" });
    expect(email.subject).toBe("This week: Home Bank's position moved on 1 fee(s)");
    expect(email.text).toContain("2 of 5 institutions charge less (last week $30.00, 1 of 4)");
    expect(email.text).toContain("Texas: 2 published fee change(s) at 2 institution(s) this week, 1 higher and 1 lower.");
    expect(email.text).toContain("$30.00 to $33.00 ($3.00 higher)");
    expect(email.text).toContain("$28.00 to $25.00 ($3.00 lower)");
    expect(email.text).toContain("https://feeinsight.com/stop");
    expect(email.text).not.toMatch(/cheapest|dearest|Bank Fee Index/i);
  });

  it("has no news when every section is empty", () => {
    expect(digestHasNews({ ...digest, stateMoves: [], positionChanges: [] })).toBe(false);
  });
});

describe("runProDigest", () => {
  const now = new Date("2026-10-12T13:11:00Z");

  function install({ readers = [readerRow()], snapshot = null as unknown }: { readers?: DigestReaderRow[]; snapshot?: unknown } = {}) {
    mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      const result = (rows: unknown[]) => Object.assign(Promise.resolve(rows), {});
      if (text.includes("FROM users u")) return result(readers);
      if (text.includes("FROM hamilton_signals s")) {
        return result([signal(5, "Lone Star CU", "TX", 11, "2026-10-08T00:00:00Z", [od(30, 33)])]);
      }
      if (text.includes("FROM published_fee_catalog c")) {
        return result([
          { institution_id: 1, institution_name: "Home Bank", state_code: "TX", fee_category: "overdraft", amount: 30 },
          { institution_id: 5, institution_name: "Lone Star CU", state_code: "TX", fee_category: "overdraft", amount: 33 },
          { institution_id: 2, institution_name: "Gulf Bank", state_code: "TX", fee_category: "overdraft", amount: 25 },
        ]);
      }
      if (text.includes("FROM pro_digest_snapshots")) {
        return result(snapshot ? [{ user_id: 20, snapshot }] : []);
      }
      return result([]);
    });
  }

  const snapshotWrites = () =>
    mocks.sql.mock.calls.filter((call) => (call[0] as TemplateStringsArray).join("?").includes("INSERT INTO pro_digest_snapshots"));

  beforeEach(() => {
    vi.stubEnv("LEAD_EMAIL_TOKEN_SECRET", "secret");
    mocks.sql.mockReset();
    mocks.sendResendEmail.mockReset();
    mocks.getTransactionalFromAddress.mockReturnValue("digest@feeinsight.com");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("counts, renders and stores the snapshot but sends nothing while switched off", async () => {
    install();
    const result = await runProDigest({ now });
    expect(result).toMatchObject({ readers: 1, withNews: 1, held: true, sent: 0, snapshotsSaved: 1 });
    expect(result.previews[0].subject).toBe("This week: 1 published fee change(s) in Texas");
    expect(mocks.sendResendEmail).not.toHaveBeenCalled();
    expect(snapshotWrites()).toHaveLength(1);
    expect(summarizeProDigest(result)).toContain("Nothing sent because PRO_EMAILS_ENABLED is off");
  });

  it("changes nothing on a dry run", async () => {
    install();
    const result = await runProDigest({ now, dryRun: true });
    expect(result).toMatchObject({ dryRun: true, withNews: 1, held: false, snapshotsSaved: 0 });
    expect(snapshotWrites()).toHaveLength(0);
    expect(mocks.sendResendEmail).not.toHaveBeenCalled();
  });

  it("sends one digest per reader per week with its own stop link once switched on", async () => {
    vi.stubEnv("PRO_EMAILS_ENABLED", "true");
    install({ snapshot: { stateCode: "TX", own: { institutionId: 1, positions: { overdraft: { amount: 30, lower: 0, of: 2 } } }, watched: { "2": { name: "Gulf Bank", fees: { overdraft: 28 } } } } });
    mocks.sendResendEmail.mockResolvedValue({ status: "sent", providerId: "e1" });
    const result = await runProDigest({ now });
    expect(result).toMatchObject({ sent: 1, held: false });
    const [message] = mocks.sendResendEmail.mock.calls[0];
    expect(message.idempotencyKey).toBe("pro-digest-20-2026-10-12");
    expect(message.headers["List-Unsubscribe"]).toContain("action=pro_digest_unsubscribe");
    expect(message.subject).toBe("This week: Home Bank's position moved on 1 fee(s)");
    expect(message.text).toContain("Gulf Bank, overdraft: $28.00 to $25.00 ($3.00 lower)");
  });

  it("skips a reader with nothing new", async () => {
    vi.stubEnv("PRO_EMAILS_ENABLED", "true");
    install({ readers: [readerRow({ own_state_code: "VT", own_fed_district: 1, watched_ids: [] })] });
    const result = await runProDigest({ now });
    expect(result).toMatchObject({ withNews: 0, quiet: 1, sent: 0 });
    expect(mocks.sendResendEmail).not.toHaveBeenCalled();
  });
});

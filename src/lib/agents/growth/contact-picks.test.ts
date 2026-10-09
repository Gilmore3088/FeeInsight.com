import { describe, expect, it, vi } from "vitest";

import { isMarketingStep, isProviderStep } from "@/lib/agents/types";
import { growthAgentForStep } from "@/lib/data-store/growth-board";
import {
  contactsCsv,
  isDecisionMaker,
  pickContacts,
  refreshContactPicks,
  runContactFinder,
  summarizeContactPicks,
  type ProspectContactRow,
} from "./contacts";
import { GROWTH_LOOP_STEPS } from "./loop";
import { isDecisionMaker as outreachIsDecisionMaker } from "./outreach";

type Db = NonNullable<Parameters<typeof refreshContactPicks>[0]>["db"];

const marketing = { kind: "person" as const, name: "Jane Smith", title: "SVP Marketing", role: "marketing" as const, email: "jsmith@firstbank.com" };
const ceo = { kind: "person" as const, name: "Robert Lee", title: "President & CEO", role: "executive" as const, email: "rlee@firstbank.com" };
const cfo = { kind: "person" as const, name: "Amy Wu", title: "Chief Financial Officer", role: "finance" as const, email: "awu@firstbank.com" };
const lender = { kind: "person" as const, name: "Tom Hart", title: "Commercial Lender", role: "other" as const, email: "thart@firstbank.com" };
const info = { kind: "general" as const, name: null, title: null, role: "other" as const, email: "info@firstbank.com" };

describe("pickContacts", () => {
  it("marks the first two decision-makers primary and backup, in rankContacts order", () => {
    const picked = pickContacts([info, lender, cfo, ceo, marketing]);
    const byEmail = new Map(picked.map((contact) => [contact.email, contact]));
    expect(byEmail.get("jsmith@firstbank.com")).toMatchObject({ pick: "primary", confidence: "high" });
    expect(byEmail.get("rlee@firstbank.com")).toMatchObject({ pick: "backup", confidence: "high" });
    expect(byEmail.get("awu@firstbank.com")).toMatchObject({ pick: null, confidence: "high" });
    expect(byEmail.get("thart@firstbank.com")).toMatchObject({ pick: null, confidence: "medium" });
    expect(byEmail.get("info@firstbank.com")).toMatchObject({ pick: null, confidence: "low" });
    // Input order is kept; only the pick and confidence are added.
    expect(picked.map((contact) => contact.email)).toEqual([info, lender, cfo, ceo, marketing].map((contact) => contact.email));
  });

  it("gives no primary when no contact is a decision-maker, and no backup when only one is", () => {
    expect(pickContacts([info, lender]).map((contact) => contact.pick)).toEqual([null, null]);
    expect(pickContacts([info, ceo]).map((contact) => contact.pick)).toEqual([null, "primary"]);
  });

  it("is the same decision-maker rule outreach uses", () => {
    expect(outreachIsDecisionMaker).toBe(isDecisionMaker);
    expect(isDecisionMaker(lender)).toBe(false);
    expect(isDecisionMaker({ ...marketing, email: "marketing@firstbank.com" })).toBe(false);
  });
});

interface Call {
  query: string;
  values: unknown[];
}

function fakeDb(options: { columns?: boolean; rows?: Array<Record<string, unknown>> } = {}) {
  const calls: Call[] = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    if (query.includes("to_regclass('public.prospect_contacts')")) return Promise.resolve([{ ready: true }]);
    if (query.includes("information_schema.columns")) return Promise.resolve([{ ready: options.columns ?? true }]);
    if (query.includes("SELECT id, institution_id, email")) return Promise.resolve(options.rows ?? []);
    if (query.includes("FROM live l")) return Promise.resolve([{ id: 7, institution_name: "First Bank", website_url: "https://www.firstbank.com/" }]);
    return Promise.resolve([]);
  });
  return { db: db as unknown as Db, calls };
}

let nextId = 1;
function saved(institutionId: number, contact: { kind: string; name: string | null; title: string | null; role: string; email: string }, stored: Partial<Record<"confidence" | "pick" | "ranked_at" | "role", unknown>> = {}) {
  return { id: nextId++, institution_id: institutionId, ...contact, confidence: null, pick: null, ranked_at: null, ...stored };
}

describe("refreshContactPicks", () => {
  it("stores role, confidence and pick for every unranked row (the backfill)", async () => {
    const rows = [saved(1, marketing), saved(1, ceo), saved(1, info), saved(2, lender)];
    const { db, calls } = fakeDb({ rows });
    const result = await refreshContactPicks({ db });
    expect(result).toMatchObject({ schemaReady: true, institutions: 2, contacts: 4, changed: 4, primary: 1, backup: 1, noBuyer: 1, byConfidence: { high: 2, medium: 1, low: 1 } });
    const update = calls.find((call) => call.query.includes("UPDATE prospect_contacts"));
    expect(update).toBeDefined();
    const [ids, roles, confidences, picks] = update!.values as [number[], string[], string[], Array<string | null>];
    expect(ids).toEqual(rows.map((row) => row.id));
    expect(roles).toEqual(["marketing", "executive", "other", "other"]);
    expect(confidences).toEqual(["high", "high", "low", "medium"]);
    expect(picks).toEqual(["primary", "backup", null, null]);
    expect(summarizeContactPicks(result)).toContain("1 primary and 1 backup buyer contacts");
  });

  it("writes only rows whose stored values changed", async () => {
    const at = "2026-10-09T00:00:00Z";
    const rows = [
      saved(1, marketing, { confidence: "high", pick: "primary", ranked_at: at }),
      saved(1, ceo, { confidence: "high", pick: null, ranked_at: at }),
      saved(1, info, { confidence: "low", pick: null, ranked_at: at }),
    ];
    const { db, calls } = fakeDb({ rows });
    const result = await refreshContactPicks({ db });
    expect(result.changed).toBe(1);
    const update = calls.find((call) => call.query.includes("UPDATE prospect_contacts"))!;
    expect(update.values[0]).toEqual([rows[1].id]);
    expect(update.values[3]).toEqual(["backup"]);
  });

  it("re-reads the role with today's rules before ranking", async () => {
    // Saved as executive under an older rule; "Vice President of Lending" is not a buyer today.
    const rows = [saved(3, { ...lender, title: "Vice President of Lending", role: "executive" })];
    const { db, calls } = fakeDb({ rows });
    const result = await refreshContactPicks({ db });
    expect(result).toMatchObject({ primary: 0, noBuyer: 1, changed: 1 });
    const update = calls.find((call) => call.query.includes("UPDATE prospect_contacts"))!;
    expect(update.values[1]).toEqual(["other"]);
  });

  it("writes nothing on a dry run, and reads nothing before the migration", async () => {
    const dry = fakeDb({ rows: [saved(1, marketing)] });
    const result = await refreshContactPicks({ db: dry.db, dryRun: true });
    expect(result).toMatchObject({ schemaReady: true, changed: 1, primary: 1 });
    expect(dry.calls.some((call) => call.query.includes("UPDATE"))).toBe(false);
    expect(summarizeContactPicks(result)).toContain("Dry run: nothing saved.");

    const before = fakeDb({ columns: false, rows: [saved(1, marketing)] });
    expect((await refreshContactPicks({ db: before.db })).schemaReady).toBe(false);
    expect(before.calls.some((call) => call.query.includes("SELECT id, institution_id"))).toBe(false);
  });

  it("limits the read to the institutions it is given", async () => {
    const { db, calls } = fakeDb({ rows: [] });
    await refreshContactPicks({ db, institutionIds: [7, 8] });
    const read = calls.find((call) => call.query.includes("SELECT id, institution_id"))!;
    expect(read.query).toContain("ANY(");
    expect(read.values[0]).toEqual([7, 8]);
  });
});

describe("runContactFinder ranking", () => {
  const fetcher = (async (url: string) => {
    const pages: Record<string, string> = {
      "https://www.firstbank.com/robots.txt": "",
      "https://www.firstbank.com/": `<p>Jane Smith</p><p>SVP Marketing</p><p>jsmith@firstbank.com</p>`,
    };
    const body = pages[url];
    return new Response(body ?? "", { status: body === undefined ? 404 : 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;

  it("ranks the institutions it just read once the columns exist", async () => {
    const { db, calls } = fakeDb({ rows: [saved(7, marketing)] });
    const result = await runContactFinder({ db, fetcher });
    expect(result.picks).toMatchObject({ schemaReady: true, primary: 1 });
    const read = calls.find((call) => call.query.includes("SELECT id, institution_id"))!;
    expect(read.values[0]).toEqual([7]);
  });

  it("skips the ranking before the migration and on a dry run", async () => {
    expect((await runContactFinder({ db: fakeDb({ columns: false }).db, fetcher })).picks).toBeNull();
    const dry = fakeDb({ rows: [saved(7, marketing)] });
    expect((await runContactFinder({ db: dry.db, fetcher, dryRun: true })).picks).toBeNull();
    expect(dry.calls.some((call) => call.query.includes("UPDATE"))).toBe(false);
  });
});

describe("contactsCsv with stored picks", () => {
  const base: Omit<ProspectContactRow, "email" | "kind" | "name" | "title" | "role"> = {
    institution_id: 7,
    institution_name: "First Bank",
    charter_type: "bank",
    state_code: "TX",
    city: "Waco",
    assets_musd: 812,
    source_url: "https://firstbank.com/leadership",
    found_at: "2026-10-08T15:30:00.000Z",
  };
  const pickColumn = (csv: string) => {
    const [header, ...lines] = csv.trim().split("\n");
    const columns = header.split(",");
    return lines.map((line) => {
      const cells = line.split(",");
      return [cells[columns.indexOf("email")], cells[columns.indexOf("pick")], cells[columns.indexOf("confidence")]].join(" ");
    });
  };

  it("uses the stored pick and confidence when every row is ranked", () => {
    const rows: ProspectContactRow[] = [
      { ...base, ...marketing, confidence: "high", pick: "backup" },
      { ...base, ...ceo, confidence: "high", pick: "primary" },
      { ...base, ...info, confidence: "low", pick: null },
    ];
    expect(pickColumn(contactsCsv(rows))).toEqual(["rlee@firstbank.com primary high", "jsmith@firstbank.com backup high", "info@firstbank.com  low"]);
  });

  it("ranks an institution here when any row is unranked, with the same buyer rule", () => {
    const rows: ProspectContactRow[] = [
      { ...base, ...info, confidence: null, pick: null },
      { ...base, ...lender },
      { ...base, ...marketing },
    ];
    expect(pickColumn(contactsCsv(rows))).toEqual(["jsmith@firstbank.com primary high", "thart@firstbank.com  medium", "info@firstbank.com  low"]);
  });
});

describe("growth-contact-picks step", () => {
  it("is a free marketing step, NIELSEN's, and in the daily loop after the contact finder", () => {
    expect(isMarketingStep("growth-contact-picks")).toBe(true);
    expect(isProviderStep("growth-contact-picks")).toBe(false);
    expect(growthAgentForStep("growth-contact-picks", {}, {})).toBe("nielsen");
    const keys = GROWTH_LOOP_STEPS.map((step) => step.key);
    expect(keys.indexOf("growth-contact-picks")).toBe(keys.indexOf("growth-contacts") + 1);
  });
});

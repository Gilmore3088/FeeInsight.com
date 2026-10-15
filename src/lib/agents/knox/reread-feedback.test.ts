import { describe, expect, it, vi } from "vitest";

import { LIVE_FRAGMENT_REREAD_KIND } from "@/lib/agents/darwin/live-fragment-check";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { isProviderStep } from "@/lib/agents/types";

import {
  KNOX_REREAD_FEEDBACK_FLAG,
  KNOX_REREAD_FEEDBACK_LIVE,
  KNOX_REREAD_FEEDBACK_SAMPLE,
  KNOX_REREAD_FEEDBACK_STRATEGY,
  KNOX_REREAD_RESOLVED_KIND,
  consumeRereadRequests,
  decideReread,
  rereadFeedbackCountSql,
  rereadResolutionKey,
  rereadStale,
  toRereadRequest,
  type RereadRequestRow,
} from "./reread-feedback";

// Lines Darwin's fragment check keeps live for a re-read ("reread") or takes down ("fragment_reread").
const PAPER_TEXT = "Account Services\nPaper statement fee for the life of the account $2.00\n";
const WIRE_TEXT = "Wire Transfers\nBank sending the wire may charge a fee of $15.00\n";
const TELLER_TEXT = "Official Checks\nTeller Check Payable to Someone Other than Member $10.00\n";

function row(overrides: Partial<RereadRequestRow> & { request_id: number; fragment: string; kept_live?: boolean; text?: string | null }): RereadRequestRow & { text: string | null } {
  const { fragment, kept_live = true, ...rest } = overrides;
  return {
    institution_id: 77,
    source_document_id: 500 + overrides.request_id,
    fee_raw_id: 900 + overrides.request_id,
    fee_published_id: 600 + overrides.request_id,
    canonical_fee_key: "paper_statement",
    amount: "2.00",
    evidence: { request: "reread_source_line", fee_name: fragment, ...(kept_live ? { kept_live: true } : {}) },
    raw_fee_name: fragment,
    live_fee_name: fragment,
    live_rolled_back: !kept_live,
    document_text_id: 700 + overrides.request_id,
    text_hash: "abc",
    source_url: "https://bank.example/fees",
    text: PAPER_TEXT,
    ...rest,
  };
}

const PAPER = row({ request_id: 1, fragment: "Paper statement fee for the" });
const WIRE = row({ request_id: 2, fragment: "Bank sending the wire may charge a fee of", canonical_fee_key: "wire_domestic_outgoing", amount: "15.00", text: WIRE_TEXT });
const TELLER = row({ request_id: 3, fragment: "Teller Check Payable to Someone Other than", canonical_fee_key: "cashiers_check", amount: "10.00", text: TELLER_TEXT, kept_live: false });

const requestOf = (fixture: ReturnType<typeof row>) => toRereadRequest(fixture);
const readOf = (text: string) => runFreeSpecialists(text).candidates;

describe("decideReread (pure)", () => {
  it("renames a kept-live fragment when today's rules read its line under a proper name", () => {
    const decision = decideReread(requestOf(PAPER), PAPER_TEXT, readOf(PAPER_TEXT));
    expect(decision).toMatchObject({ outcome: "renamed", newName: "Paper statement fee for the life of the account" });
  });

  it("settles as same_name when today's rules give the same fragment back (no loop: once per rules version)", () => {
    const decision = decideReread(requestOf(WIRE), WIRE_TEXT, readOf(WIRE_TEXT));
    expect(decision.outcome).toBe("same_name");
    expect(decision.readNames).toEqual(["Bank sending the wire may charge a fee of"]);
  });

  it("sends a taken-down fee's proper read to Darwin", () => {
    const decision = decideReread(requestOf(TELLER), TELLER_TEXT, readOf(TELLER_TEXT));
    expect(decision).toMatchObject({ outcome: "sent_to_darwin", newName: "Teller Check Payable to Someone Other than Member" });
    expect(decision.candidate).toMatchObject({ amount: 10, canonicalHint: "cashiers_check" });
  });

  it("finds the line by Darwin's fragment only: a generic raw name never lends another line's name", () => {
    // Darwin's fragment is no longer in the text; Knox's raw name "Statement Fee" is in both lines
    // at $2.00. Matched on the raw name, "Paper Statement Fee" (the other line) was the donor.
    const text = "Account Services\nPaper Statement Fee $2.00\nE-Statement Fee $2.00\n";
    const request = requestOf({ ...PAPER, raw_fee_name: "Statement Fee", evidence: { fee_name: "Statement copy fee for the", kept_live: true }, live_fee_name: "Statement copy fee for the" });
    expect(decideReread(request, text, readOf(text))).toMatchObject({ outcome: "not_found" });
    // A word that only begins the fragment is not the fragment: whole words only.
    const glued = requestOf({ ...PAPER, evidence: { fee_name: "aper statement fee for the", kept_live: true } });
    expect(decideReread(glued, PAPER_TEXT, readOf(PAPER_TEXT)).outcome).toBe("not_found");
  });

  it("settles a fragment under three words as ambiguous: too short to find one line by", () => {
    const text = "Account Services\nPaper Statement Fee $2.00\nE-Statement Fee $2.00\n";
    for (const fragment of ["Fee", "Service charge", "Fee for"]) {
      const request = requestOf({ ...PAPER, evidence: { fee_name: fragment, kept_live: true }, live_fee_name: fragment, raw_fee_name: fragment });
      expect(decideReread(request, text, readOf(text))).toEqual({ outcome: "ambiguous" });
    }
  });

  it("reports no text, a line not found at the price, and another category", () => {
    expect(decideReread(requestOf(PAPER), null, []).outcome).toBe("no_text");
    expect(decideReread(requestOf({ ...PAPER, amount: "3.00" }), PAPER_TEXT, readOf(PAPER_TEXT)).outcome).toBe("not_found");
    expect(decideReread(requestOf({ ...PAPER, canonical_fee_key: "overdraft" }), PAPER_TEXT, readOf(PAPER_TEXT)).outcome).toBe("other_category");
  });

  it("reads a request as stale when the kept-live fee was renamed or taken down, or the taken-down fee is live again", () => {
    expect(rereadStale(requestOf(PAPER))).toBe(false);
    expect(rereadStale(requestOf({ ...PAPER, live_fee_name: "Paper Statement Fee" }))).toBe(true);
    expect(rereadStale(requestOf({ ...PAPER, live_rolled_back: true }))).toBe(true);
    expect(rereadStale(requestOf(TELLER))).toBe(false);
    expect(rereadStale(requestOf({ ...TELLER, live_rolled_back: false }))).toBe(true);
  });
});

type DbMock = ReturnType<typeof vi.fn>;

/** A fake store: requests stay pending until a resolution row with their key is written. */
function dbFor(requests: Array<ReturnType<typeof row>>) {
  const resolved = new Set<string>();
  const pending = () => requests.filter((request) => !resolved.has(rereadResolutionKey(Number(request.request_id))));
  const db: DbMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("FILTER (WHERE req.evidence->>'kept_live' = 'true') AS reread")) {
      const open = pending();
      return Promise.resolve([{
        reread: open.filter((request) => (request.evidence as Record<string, unknown>).kept_live === true).length,
        fragment_reread: open.filter((request) => (request.evidence as Record<string, unknown>).kept_live !== true).length,
        documents: new Set(open.map((request) => request.source_document_id)).size,
        institutions: new Set(open.map((request) => request.institution_id)).size,
      }]);
    }
    if (text.includes("SELECT req.id AS request_id\n")) {
      const limit = Number(values[values.length - 1]);
      return Promise.resolve(pending().slice(0, limit).map((request) => ({ request_id: request.request_id })));
    }
    if (text.includes("WHERE req.id = ANY")) {
      const ids = new Set((values[0] as number[]).map(Number));
      return Promise.resolve(requests.filter((request) => ids.has(Number(request.request_id))));
    }
    if (text.includes("FROM agent_source_texts WHERE id = ANY")) {
      const ids = new Set((values[0] as number[]).map(Number));
      return Promise.resolve(requests.filter((request) => ids.has(Number(request.document_text_id))).map((request) => ({ id: request.document_text_id, normalized_text: request.text })));
    }
    if (text.includes("INSERT INTO pipeline_feedback")) {
      const rows = JSON.parse(String(values[0])) as Array<{ dedupe_key: string; kind: string }>;
      for (const written of rows) if (written.kind === KNOX_REREAD_RESOLVED_KIND) resolved.add(written.dedupe_key);
      return Promise.resolve(rows.map((_, index) => ({ id: index + 1 })));
    }
    if (text.includes("INSERT INTO raw_fee_observations")) return Promise.resolve([{ fee_raw_id: 4242 }]);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve((values[0] as number[]).map((id) => ({ fee_published_id: id })));
    return Promise.resolve([]);
  });
  return { db, resolved };
}

const asDb = (db: DbMock) => db as unknown as Parameters<typeof consumeRereadRequests>[0];
const sqlTexts = (db: DbMock) => db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?"));

describe("consumeRereadRequests", () => {
  it("is off by default and is a deterministic sub-pass of the extract step, never a provider step", () => {
    expect(KNOX_REREAD_FEEDBACK_LIVE).toBe(false);
    expect(isProviderStep("extract")).toBe(false);
  });

  it("switch off: counts the pending requests, reads a sample read-only and writes only its one event", async () => {
    const { db, resolved } = dbFor([PAPER, WIRE, TELLER]);
    const result = await consumeRereadRequests(asDb(db), { runId: 7, stepId: 70, dryRun: false });
    expect(result).toMatchObject({ live: false, pending: 3, pendingByKind: { reread: 2, fragment_reread: 1 }, pendingDocuments: 3, pendingInstitutions: 1, read: 3, resolved: 0, renamed: [], sentToDarwin: [] });
    expect(result.outcomes).toEqual({ renamed: 1, same_name: 1, sent_to_darwin: 1 });
    const texts = sqlTexts(db);
    expect(texts.filter((text) => /INSERT|UPDATE/.test(text))).toEqual([expect.stringContaining("INSERT INTO agent_run_events")]);
    expect(texts.some((text) => text.includes("FOR UPDATE"))).toBe(false);
    expect(resolved.size).toBe(0);
    const event = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("INSERT INTO agent_run_events"));
    expect(event?.[3]).toBe(KNOX_REREAD_FEEDBACK_STRATEGY.strategy);
    expect(String(event?.[4])).toContain("switch off, nothing written");
  });

  it("writes no event and reads nothing when no request is pending", async () => {
    const { db } = dbFor([]);
    const result = await consumeRereadRequests(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result).toMatchObject({ pending: 0, read: 0 });
    // Switch on, the claim is the only read: no separate count before it.
    expect(sqlTexts(db)).toEqual([expect.stringContaining("FOR UPDATE OF req SKIP LOCKED")]);
  });

  it("switch off: a state or all-bank lane skips the pass (skipSample) and reads nothing", async () => {
    const { db } = dbFor([PAPER, WIRE, TELLER]);
    const result = await consumeRereadRequests(asDb(db), { runId: 7, dryRun: false, skipSample: true, stateCode: "TX" });
    expect(result).toMatchObject({ skipped: true, pending: 0, read: 0 });
    expect(db).not.toHaveBeenCalled();
    // The switch on, skipSample does not apply: the claim path runs in every lane.
    const { db: liveDb } = dbFor([PAPER]);
    expect(await consumeRereadRequests(asDb(liveDb), { runId: 7, dryRun: false, live: true, skipSample: true })).toMatchObject({ skipped: false, read: 1 });
  });

  it("switch off: a one-bank run reads at most the sample", async () => {
    const many = Array.from({ length: 6 }, (_, index) => row({ request_id: 10 + index, fragment: "Paper statement fee for the" }));
    const { db } = dbFor(many);
    const result = await consumeRereadRequests(asDb(db), { runId: 7, dryRun: false, institutionId: 77 });
    expect(KNOX_REREAD_FEEDBACK_SAMPLE).toBe(3);
    expect(result).toMatchObject({ pending: 6, read: 3 });
    expect(result.samples).toHaveLength(3);
  });

  it("a dry run writes nothing at all, even switched on", async () => {
    const { db } = dbFor([PAPER, WIRE, TELLER]);
    const result = await consumeRereadRequests(asDb(db), { runId: 7, dryRun: true, live: true });
    expect(result.read).toBe(3);
    expect(sqlTexts(db).some((text) => /INSERT|UPDATE|FOR UPDATE/.test(text))).toBe(false);
  });

  it("switch on: claims the batch, renames, sends to Darwin, settles every request once and never reads it again", async () => {
    const { db, resolved } = dbFor([PAPER, WIRE, TELLER]);
    const result = await consumeRereadRequests(asDb(db), { runId: 7, stepId: 70, dryRun: false, live: true });
    expect(result).toMatchObject({ live: true, read: 3, resolved: 3, renamed: [601], sentToDarwin: [603] });
    expect(result.outcomes).toEqual({ renamed: 1, same_name: 1, sent_to_darwin: 1 });
    const texts = sqlTexts(db);
    expect(texts.some((text) => text.includes("FOR UPDATE OF req SKIP LOCKED"))).toBe(true);
    // The rename goes through Knox's live rename path: the old name logged, then the guarded update.
    expect(texts.some((text) => text.includes("SET fee_name = rename.new_name") && text.includes("fp.fee_name = rename.old_name"))).toBe(true);
    // The taken-down fee's proper read goes to Darwin as a raw row with the pass's flag.
    const insert = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("INSERT INTO raw_fee_observations"));
    expect(JSON.stringify(insert)).toContain(KNOX_REREAD_FEEDBACK_FLAG);
    expect(JSON.stringify(insert)).toContain("needs_darwin_verification");
    expect(JSON.stringify(insert)).toContain("Teller Check Payable to Someone Other than Member");
    // One resolution row per request, keyed on the request, pass version and rules version.
    expect([...resolved].sort()).toEqual([1, 2, 3].map((id) => rereadResolutionKey(id)));
    const resolutionCall = db.mock.calls.find(([strings, json]) =>
      (strings as TemplateStringsArray).join("?").includes("INSERT INTO pipeline_feedback") && String(json).includes(KNOX_REREAD_RESOLVED_KIND));
    const rows = JSON.parse(String(resolutionCall?.[1])) as Array<Record<string, unknown>>;
    const wire = rows.find((written) => (written.evidence as Record<string, unknown>).request_id === 2);
    expect(wire).toMatchObject({ signal: "wrong", weight: 0, reported_by: "knox", evidence: expect.objectContaining({ outcome: "same_name", resolved: false, note: "unresolved: same name under today's rules" }) });
    expect(rows.find((written) => (written.evidence as Record<string, unknown>).request_id === 1)).toMatchObject({ signal: "right", evidence: expect.objectContaining({ outcome: "renamed", resolved: true }) });

    // The next step finds nothing pending: no request is read twice at one rules version.
    db.mockClear();
    const again = await consumeRereadRequests(asDb(db), { runId: 8, dryRun: false, live: true });
    expect(again).toMatchObject({ pending: 0, read: 0, resolved: 0 });
    expect(sqlTexts(db).some((text) => /INSERT INTO|UPDATE published_fee_records/.test(text))).toBe(false);
  });

  it("switch on: a request whose proper name another live fee of the bank has is settled as a live twin, not renamed", async () => {
    const { db } = dbFor([PAPER]);
    const base = db.getMockImplementation() as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    db.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.join("?").includes("AS v(request_id, institution_id, fee_published_id, new_name, amount)") ? Promise.resolve([{ request_id: 1 }]) : base(strings, ...values));
    const result = await consumeRereadRequests(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result.outcomes).toEqual({ live_twin: 1 });
    expect(result.renamed).toEqual([]);
    expect(sqlTexts(db).some((text) => text.includes("UPDATE published_fee_records"))).toBe(false);
  });

  it("switch on: a rename the guarded update did not apply is settled as name_changed, not renamed", async () => {
    const { db } = dbFor([PAPER]);
    const base = db.getMockImplementation() as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    db.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.join("?").includes("UPDATE published_fee_records") ? Promise.resolve([]) : base(strings, ...values));
    const result = await consumeRereadRequests(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result).toMatchObject({ renamed: [], resolved: 1, outcomes: { name_changed: 1 } });
  });

  it("switch on: a read repeating a takedown Hamilton confirmed is written held, not sent to Darwin", async () => {
    const { db } = dbFor([TELLER]);
    const base = db.getMockImplementation() as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    db.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (text.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
      if (text.includes("f.kind = 'takedown_confirmed'")) {
        return Promise.resolve([{ institution_id: 77, fee_name: "Teller Check Payable to Someone Other than Member", amount: "10.00", check_name: "hamilton.source_check" }]);
      }
      return base(strings, ...values);
    });
    const result = await consumeRereadRequests(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result).toMatchObject({ sentToDarwin: [], resolved: 1, outcomes: { held_taken_down: 1 } });
    const insert = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("INSERT INTO raw_fee_observations"));
    const flags = JSON.parse(String(insert?.slice(1).find((value) => String(value).includes(KNOX_REREAD_FEEDBACK_FLAG)))) as string[];
    expect(flags).toEqual(expect.arrayContaining(["knox_review:taken_down", "knox_lesson:taken_down:hamilton.source_check", KNOX_REREAD_FEEDBACK_FLAG]));
    expect(flags).not.toContain("needs_darwin_verification");
  });

  it("switch on: a failed write is settled unresolved, so it never holds the head of the queue", async () => {
    const { db, resolved } = dbFor([PAPER, WIRE]);
    const base = db.getMockImplementation() as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    db.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.join("?").includes("UPDATE published_fee_records") ? Promise.reject(new Error("write failed")) : base(strings, ...values));
    const first = await consumeRereadRequests(asDb(db), { runId: 7, dryRun: false, live: true, limit: 1 });
    expect(first).toMatchObject({ read: 1, resolved: 1, renamed: [], outcomes: { refused: 1 } });
    expect(first.samples[0]).toMatchObject({ request_id: 1, refused_by: "write_failed" });
    expect(resolved.has(rereadResolutionKey(1))).toBe(true);
    // The next step claims the next request, not the failed one again.
    const second = await consumeRereadRequests(asDb(db), { runId: 8, dryRun: false, live: true, limit: 1 });
    expect(second.samples.map((sample) => sample.request_id)).toEqual([2]);
  });

  it("never throws: a failed read reports failed and writes nothing", async () => {
    const db: DbMock = vi.fn(() => Promise.reject(new Error("read failed")));
    const result = await consumeRereadRequests(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result).toMatchObject({ failed: true, read: 0, resolved: 0 });
  });
});

describe("rereadFeedbackCountSql", () => {
  it("is a read-only count keyed like the step's resolution rows", () => {
    const text = rereadFeedbackCountSql();
    expect(text).toContain("BEGIN READ ONLY;");
    expect(text).toContain("SET LOCAL statement_timeout = '120s';");
    expect(text.trim().endsWith("ROLLBACK;")).toBe(true);
    expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(text).toContain(`req.kind = '${LIVE_FRAGMENT_REREAD_KIND}'`);
    const key = rereadResolutionKey(123);
    const [prefix, suffix] = key.split("123");
    expect(text).toContain(`'${prefix}' || req.id || '${suffix}'`);
    expect(suffix).toContain(`rules${KNOX_RULES_STRATEGY.version}`);
  });
});

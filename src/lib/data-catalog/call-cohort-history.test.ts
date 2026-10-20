import { describe, expect, it, vi } from "vitest";
import type { withTransaction } from "@/lib/data-store/connection";
import {
  buildCallCohortHistory, callCohortWindow, loadCallCohortFacts, readCallCohortHistory,
  MAX_COHORT_EVENTS, MAX_COHORT_IDENTITIES, MAX_COHORT_PERIODS, MAX_COHORT_REPORTERS,
  type CallCohortEvent, type CallCohortIdentity, type CallCohortPeriodInput,
} from "./call-cohort-history";

const identity = (id: number, overrides: Partial<CallCohortIdentity> = {}): CallCohortIdentity => ({
  id, source: "ncua", charter_type: "credit_union", cert_number: String(100 + id), ncua_charter_id: String(100 + id),
  institution_name: `Current registry ${id}`, regulatory_status: "active", closed_date: null, ...overrides,
});
const period = (date: string, reporters: number[], overrides: Partial<CallCohortPeriodInput> = {}): CallCohortPeriodInput => ({
  period: date, unit: "USD", period_basis: "ytd", sources: ["ncua"], institution_count: reporters.length,
  reporting_institution_ids: reporters, reporter_ids_complete: true, ...overrides,
});
const event = (overrides: Partial<CallCohortEvent> = {}): CallCohortEvent => ({
  id: 1, source: "ncua-mergers", event_key: "generic-merger", institution_id: null,
  cert: "101", outgoing_cert: "101", acquirer_cert: "102", survivor_cert: "102",
  effective_date: "2026-01-01", change_code: "merger", change_description: "Published merger",
  source_url: "https://ncua.gov/fixture", ...overrides,
});
const facts = { identities: [identity(1, { regulatory_status: "inactive", closed_date: "2026-01-01" }), identity(2), identity(3)], identity_read_status: "complete" as const, lifecycle_read_status: "complete" as const };
const history = (overrides: Parameters<typeof buildCallCohortHistory>[0] = { periods: [] as CallCohortPeriodInput[], requestedIds: null }) => buildCallCohortHistory({
  ...facts, ...overrides,
});

describe("dated call-report cohort history", () => {
  it("separates requested members from exact sorted reporters and preserves a now-inactive predecessor", () => {
    const result = history({ requestedIds: [3, 2, 1, 2], subjectId: 1,
      periods: [period("2026-06-30", [2, 3]), period("2025-06-30", [2, 1])], lifecycleEvents: [event()] });
    expect(result.requested).toEqual({ institution_ids: [1, 2, 3], member_count: 3, ids_complete: true });
    expect(result.periods.map((row) => [row.period, row.reporting_institution_ids, row.subject_included])).toEqual([
      ["2026-06-30", [2, 3], false], ["2025-06-30", [1, 2], true],
    ]);
    expect(result.charter_refs[0]).toMatchObject({ institution_id: 1, source: "ncua", current_regulatory_status: "inactive", identity_state: "resolved" });
    expect(result.membership_changes).toEqual([{ source: "ncua", unit: "USD", period_basis: "ytd", from_period: "2025-06-30", to_period: "2026-06-30", complete: true, common_ids: [2], added_ids: [3], dropped_ids: [1] }]);
    expect(result.lifecycle.events[0]).toMatchObject({ certainty: "published_event_unreviewed", related_members: [
      { institution_id: 1, source: "ncua", roles: ["cert", "predecessor"] },
      { institution_id: 2, source: "ncua", roles: ["acquirer", "survivor"] },
    ] });
    expect(result).toMatchObject({ basis: "period_cross_sections", identity_basis: "current_registry_links_not_dated_identity", eligibility_basis: "reported_curated_line", growth_status: "not_established", merger_adjusted: false });
  });

  it("does not equate stable charter IDs with the same business or complete lifecycle coverage", () => {
    const result = history({ periods: [period("2025-06-30", [2]), period("2026-06-30", [2])], requestedIds: [2], lifecycleEvents: [] });
    expect(result.membership_changes[0]).toMatchObject({ complete: true, common_ids: [2], added_ids: [], dropped_ids: [] });
    expect(result.lifecycle).toMatchObject({ read_status: "complete", coverage: "not_established", events: [] });
    expect(result.growth_status).toBe("not_established");
    expect(result.merger_adjusted).toBe(false);
  });

  it("looks back to January 1 for YTD income and marks member votes as proposals, not completion", () => {
    const result = history({ requestedIds: null, periods: [period("2025-06-30", [1, 2]), period("2026-06-30", [2])],
      lifecycleEvents: [event({ source: "ncua-proposed-mergers", event_key: "vote", effective_date: "2025-12-08", change_code: "proposed_merger" }), event({ id: 2, event_key: "early", effective_date: "2025-02-01" }), event({ id: 3, event_key: "too-early", effective_date: "2024-12-31" })] });
    expect(result.lifecycle.window_start).toBe("2025-01-01");
    expect(result.lifecycle.events.map((row) => row.event_key)).toEqual(["vote", "early"]);
    expect(result.lifecycle.events[0]).toMatchObject({ date_basis: "member_vote", certainty: "proposal_not_completion" });
  });

  it("starts derived-quarter and balance windows at their actual period boundaries", () => {
    expect(callCohortWindow([period("2026-06-30", [2], { period_basis: "standalone_quarter" })])).toEqual({ start: "2026-04-01", end: "2026-06-30" });
    expect(callCohortWindow([period("2026-06-30", [2], { period_basis: "point_in_time" })])).toEqual({ start: "2026-06-30", end: "2026-06-30" });
  });

  it("keeps FDIC financial and FFIEC raw series separate but uses their shared bank identity namespace", () => {
    const result = history({ requestedIds: [2], identities: [identity(2, { source: "fdic", charter_type: "bank", ncua_charter_id: null })],
      eligibility_basis: "positive_standalone_quarter_income",
      periods: [period("2025-06-30", [2], { sources: ["fdic"] }), period("2026-06-30", [2], { sources: ["ffiec"] })],
      lifecycleEvents: [event({ source: "fdic-history" }), event({ id: 2, source: "ncua-mergers" })] });
    expect(result.membership_changes).toEqual([]);
    expect(result.periods.every((row) => row.identity_refs_complete)).toBe(true);
    expect(result.lifecycle.events).toHaveLength(1);
    expect(result.lifecycle.events[0].source).toBe("fdic-history");
    expect(result.eligibility_basis).toBe("positive_standalone_quarter_income");
  });

  it("does not compare different sources, units or period bases", () => {
    const result = history({ requestedIds: null, periods: [period("2025-06-30", [2]),
      period("2026-06-30", [2], { unit: "count" }), period("2026-06-30", [2], { period_basis: "point_in_time" })] });
    expect(result.membership_changes).toEqual([]);
  });

  it("marks missing and contradictory current registry identifiers without filling them", () => {
    const result = history({ requestedIds: [1, 2, 3], identities: [identity(1, { ncua_charter_id: "999" }), identity(2, { charter_type: "bank" })], periods: [period("2026-06-30", [1, 2, 3])] });
    expect(result.charter_refs.map((row) => row.identity_state)).toEqual(["conflicting", "conflicting", "missing"]);
    expect(result.periods[0].identity_refs_complete).toBe(false);
    expect(result.charter_refs[2].cert_number).toBeNull();
  });

  it.each(["ncua", "ffiec", "fdic"])("does not resolve an all-zero %s charter or certificate", (source) => {
    const result = history({ requestedIds: [2], periods: [period("2026-06-30", [2], { sources: [source] })],
      identities: [identity(2, { charter_type: source === "ncua" ? "credit_union" : "bank", cert_number: "0000", ncua_charter_id: source === "ncua" ? "0" : null })],
      lifecycleEvents: [event({ source: source === "ncua" ? "ncua-mergers" : "fdic-history", cert: "0", outgoing_cert: "0000", acquirer_cert: null, survivor_cert: null })] });
    expect(result.charter_refs[0].identity_state).toBe("missing");
    expect(result.charter_refs_complete).toBe(false);
    expect(result.periods[0].identity_refs_complete).toBe(false);
    expect(result.lifecycle.events).toEqual([]);
  });

  it("does not turn a missing or count-mismatched reporter list into complete membership changes", () => {
    const result = history({ requestedIds: null, periods: [period("2025-06-30", [1, 2]), period("2026-06-30", [2], { institution_count: 2 })] });
    expect(result.periods[1].reporter_ids_complete).toBe(false);
    expect(result.membership_changes[0]).toMatchObject({ complete: false, common_ids: null, added_ids: null, dropped_ids: null });
    expect(history({ requestedIds: null, periods: [period("2026-06-30", [], { reporting_institution_ids: undefined })] }).periods[0].reporter_ids_complete).toBe(false);
    const partial = history({ requestedIds: null, subjectId: 513, periods: [period("2026-06-30", Array.from({ length: 512 }, (_, at) => at + 1), { institution_count: 513, reporter_ids_complete: false, subject_included: true })] });
    expect(partial.periods[0]).toMatchObject({ reporter_ids_complete: false, subject_included: true });
  });

  it("bounds reporter, identity, period and event references and surfaces incomplete coverage", () => {
    const reporters = Array.from({ length: MAX_COHORT_REPORTERS + 1 }, (_, at) => at + 1);
    const result = history({ requestedIds: Array.from({ length: MAX_COHORT_IDENTITIES + 1 }, (_, at) => at + 1),
      periods: Array.from({ length: MAX_COHORT_PERIODS + 1 }, () => period("2026-06-30", reporters)),
      lifecycleEvents: Array.from({ length: MAX_COHORT_EVENTS + 1 }, (_, at) => event({ id: at + 1, event_key: `e${at}` })) });
    expect(result.requested).toMatchObject({ member_count: 2001, ids_complete: false });
    expect(result.requested.institution_ids).toHaveLength(MAX_COHORT_IDENTITIES);
    expect(result.periods).toHaveLength(MAX_COHORT_PERIODS);
    expect(result.periods_complete).toBe(false);
    expect(result.periods[0].reporting_institution_ids).toHaveLength(MAX_COHORT_REPORTERS);
    expect(result.periods[0].reporter_ids_complete).toBe(false);
    expect(result.charter_refs).toHaveLength(MAX_COHORT_REPORTERS);
    expect(result.charter_refs_complete).toBe(false);
    expect(result.lifecycle).toMatchObject({ read_status: "truncated", coverage: "not_established" });
    expect(result.lifecycle.events).toHaveLength(MAX_COHORT_EVENTS);
  });

  it("deduplicates repeated charter references and marks a distinct-reference overflow explicitly", () => {
    const repeated = history({ requestedIds: [2], periods: [period("2025-06-30", [2]), period("2026-06-30", [2])] });
    expect(repeated.charter_refs).toHaveLength(1);
    expect(repeated.charter_refs_complete).toBe(true);
    const all = Array.from({ length: 2560 }, (_, at) => at + 1);
    const result = history({ requestedIds: null, identities: all.map((id) => identity(id)), periods: ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"]
      .map((date, at) => period(date, all.slice(at * 512, (at + 1) * 512))) });
    expect(result.charter_refs).toHaveLength(MAX_COHORT_IDENTITIES);
    expect(result.charter_refs_complete).toBe(false);
    expect(result.periods[4]).toMatchObject({ reporter_ids_complete: true, identity_refs_complete: false, reported_count: 512 });
    expect(result.periods[4].reporting_institution_ids).toHaveLength(512);
  });

  it("keeps undated linked events explicitly uncertain and excludes unrelated charters", () => {
    const result = history({ requestedIds: [2], periods: [period("2026-06-30", [2])], lifecycleEvents: [
      event({ effective_date: null }), event({ id: 2, cert: "999", outgoing_cert: null, acquirer_cert: null, survivor_cert: null }),
    ] });
    expect(result.lifecycle.events).toHaveLength(1);
    expect(result.lifecycle.events[0].date_basis).toBe("unknown");
  });

  it.each(["fdic-history", "unknown-regulator", "ncua-unreviewed-source"])("rejects %s even when its stored institution link points to the CU reporter", (source) => {
    const result = history({ requestedIds: [2], periods: [period("2026-06-30", [2])], lifecycleEvents: [event({ source, institution_id: 2, cert: "999", outgoing_cert: null, acquirer_cert: null, survivor_cert: null })] });
    expect(result.lifecycle.events).toEqual([]);
  });

  it("rejects a credit-union event whose linked ID points to the bank reporter", () => {
    const result = history({ requestedIds: [2], periods: [period("2026-06-30", [2], { sources: ["ffiec"] })],
      identities: [identity(2, { source: "fdic", charter_type: "bank", ncua_charter_id: null })], lifecycleEvents: [event({ institution_id: 2 })] });
    expect(result.lifecycle.events).toEqual([]);
  });

  it.each(["fdic-history", "fdic-failures", "fed-h2", "occ-bulletin", "fed-orders", "occ-merger-decisions"])("retains the recognized bank source %s without treating a release or decision as completion", (source) => {
    const result = history({ requestedIds: [2], periods: [period("2026-06-30", [2], { sources: ["fdic"] })],
      identities: [identity(2, { source: "fdic", charter_type: "bank", ncua_charter_id: null })],
      lifecycleEvents: [event({ source, institution_id: 2, cert: null, outgoing_cert: null, acquirer_cert: null, survivor_cert: null })] });
    expect(result.lifecycle.events).toHaveLength(1);
    expect(result.lifecycle.events[0]).toMatchObject({ related_members: [{ institution_id: 2, source: "fdic", roles: ["institution"] }],
      date_basis: source.startsWith("fdic-") ? "reported_effective_date" : "publication_or_decision_date", certainty: "published_event_unreviewed" });
    expect(result).toMatchObject({ growth_status: "not_established", merger_adjusted: false });
    expect(result.lifecycle.coverage).toBe("not_established");
  });
});

function reader(responses: Array<unknown[] | Error>) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const query = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join(""), values });
    if (strings.join("").includes("SET LOCAL")) return [];
    const response = responses.shift() ?? [];
    if (response instanceof Error) throw response;
    return response;
  });
  const read = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(query)) as unknown as typeof withTransaction;
  return { query, read, queries };
}

describe("bounded optional cohort fact reads", () => {
  const input = { periods: [period("2025-06-30", [1, 2]), period("2026-06-30", [2])], requestedIds: [1, 2] };
  it("performs no SQL for an empty result", async () => {
    const { query, read } = reader([]);
    const result = await readCallCohortHistory({ periods: [], requestedIds: [2] }, read);
    expect(query).not.toHaveBeenCalled();
    expect(result.lifecycle.read_status).toBe("not_compared");
    expect(result.periods).toEqual([]);
  });

  it("loads identity and lifecycle facts in separate bounded transactions", async () => {
    const { query, read } = reader([[identity(1), identity(2)], [event()]]);
    const result = await readCallCohortHistory(input, read);
    expect(read).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.filter(([strings]) => strings.join("").includes("SET LOCAL"))).toHaveLength(2);
    expect(result.lifecycle).toMatchObject({ read_status: "complete", coverage: "not_established", window_start: "2025-01-01" });
    expect(result.lifecycle.events).toHaveLength(1);
  });

  it("keeps financial histories available when identities or lifecycle tables are unavailable", async () => {
    const identityFailure = reader([new Error("missing table")]);
    expect(await readCallCohortHistory(input, identityFailure.read)).toMatchObject({ identity_read_status: "unavailable", periods: [expect.anything(), expect.anything()], lifecycle: { read_status: "unavailable", events: [] } });
    const lifecycleFailure = reader([[identity(1), identity(2)], new Error("statement timeout")]);
    expect(await readCallCohortHistory(input, lifecycleFailure.read)).toMatchObject({ identity_read_status: "complete", lifecycle: { read_status: "unavailable", coverage: "not_established", events: [] } });
  });

  it("does not read events for a single period or different source series", async () => {
    const { read } = reader([[identity(2)]]);
    const result = await loadCallCohortFacts({ periods: [period("2025-06-30", [2]), period("2026-06-30", [2], { sources: ["ffiec"] })], requestedIds: null }, read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.lifecycle_read_status).toBe("not_compared");
  });

  it("marks a bounded identity or event read truncated rather than claiming complete coverage", async () => {
    const many = Array.from({ length: MAX_COHORT_IDENTITIES + 1 }, (_, at) => at + 1);
    const { read } = reader([many.slice(0, MAX_COHORT_IDENTITIES).map((id) => identity(id)), Array.from({ length: MAX_COHORT_EVENTS + 1 }, (_, at) => event({ id: at + 1 }))]);
    const result = await loadCallCohortFacts({ periods: [period("2025-06-30", many), period("2026-06-30", many)], requestedIds: null }, read);
    expect(result).toMatchObject({ identity_read_status: "truncated", lifecycle_read_status: "truncated" });
    expect(result.lifecycleEvents).toHaveLength(MAX_COHORT_EVENTS + 1);
  });

  it("keeps an actual high-ID reporter when more than 2000 requested-only members have lower IDs", async () => {
    const requested = [...Array.from({ length: MAX_COHORT_IDENTITIES + 1 }, (_, at) => at + 1), 10000];
    const { read, queries } = reader([[identity(10000)]]);
    const result = await readCallCohortHistory({ requestedIds: requested, periods: [period("2026-06-30", [10000])] }, read);
    const lookup = queries.find((query) => query.text.includes("FROM institution_sources"));
    expect(lookup?.values[0]).toEqual([10000]);
    expect(result).toMatchObject({ identity_read_status: "complete", charter_refs_complete: true,
      requested: { member_count: 2002, ids_complete: false }, periods: [expect.objectContaining({ reporting_institution_ids: [10000], identity_refs_complete: true })] });
    expect(result.charter_refs).toEqual([expect.objectContaining({ institution_id: 10000, identity_state: "resolved" })]);
  });
});
